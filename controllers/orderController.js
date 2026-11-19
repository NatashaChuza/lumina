const { db } = require('../config/firebase');
const transporter = require('../config/mailer');
const { quoteCart, parseSizes, sanitizeCart } = require('../services/pricing');
const { verifyCollection } = require('../services/lenco');

const PAY_METHODS = ['airtel', 'mtn', 'card', 'cash'];
const DELIVERY = { lusaka: 'Lusaka (Yango biker)', outside: 'Outside Lusaka (Platinum)' };
const cashAllowed = () => String(process.env.ALLOW_CASH_ON_DELIVERY || 'false').toLowerCase() === 'true';
// Lenco needs an email for every payment. Customers are not asked for one,
// so payment receipts go to the store's own address.
const receiptEmail = () => process.env.LENCO_RECEIPT_EMAIL || process.env.EMAIL_TO || process.env.EMAIL_USER || '';

const clean = (v, max = 200) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const safeRef = (r) => /^[A-Za-z0-9._-]{6,80}$/.test(String(r || '')) ? String(r) : null;

// POST /api/checkout/quote  { cart: [{ id, size, quantity }] }
exports.quote = async (req, res) => {
  try {
    const q = await quoteCart(req.body.cart);
    if (!q.items.length) return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    return res.status(200).json({ success: true, ...q, receiptEmail: receiptEmail() });
  } catch (error) {
    console.error('quote error:', error);
    return res.status(500).json({ success: false, message: 'Could not check your cart. Please try again.' });
  }
};

function readOrderBody(body) {
  const customer = {
    name: clean(body.customer?.name, 80),
    phone: clean(body.customer?.phone, 20).replace(/\s+/g, ''),
    email: clean(body.customer?.email, 120),
  };
  const delivery = {
    method: DELIVERY[body.delivery?.method] ? body.delivery.method : 'lusaka',
    address: clean(body.delivery?.address, 200),
    town: clean(body.delivery?.town, 80),
  };
  return {
    customer,
    delivery,
    paymentMethod: PAY_METHODS.includes(body.paymentMethod) ? body.paymentMethod : null,
    note: clean(body.note, 500),
    specialPacking: !!body.specialPacking,
    cart: sanitizeCart(body.cart),
  };
}

function validate(o) {
  if (!/^0[79]\d{8}$/.test(o.customer.phone)) return 'Please enter a 10-digit phone number, like 0977123456.';
  if (!o.paymentMethod) return 'Please choose how you want to pay.';
  if (o.paymentMethod === 'cash' && !cashAllowed()) return 'Cash on delivery is not available.';
  if (!o.cart.length) return 'Your cart is empty.';
  return null;
}

// Reduce stock and save the order in one transaction. If stock ran out for a
// paid order, the order is still saved (the customer has paid) and flagged.
async function saveOrder(docId, order, { reduceStock }) {
  const ref = db.collection('sales').doc(docId);
  let stockProblems = [];

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      order.__alreadySaved = true;
      return;
    }

    const updates = [];
    if (reduceStock) {
      for (const item of order.cart) {
        const pref = db.collection('products').doc(item.id);
        const snap = await tx.get(pref);
        if (!snap.exists) { stockProblems.push(`${item.productName}: product missing`); continue; }
        const sizes = parseSizes(snap.data().sizes);
        const idx = sizes.findIndex((s) => String(s.size) === String(item.size));
        if (idx === -1) { stockProblems.push(`${item.productName}: size ${item.size} missing`); continue; }
        const left = Number(sizes[idx].quantity) || 0;
        if (left < item.quantity) stockProblems.push(`${item.productName} size ${item.size}: ordered ${item.quantity}, only ${left} left`);
        sizes[idx].quantity = Math.max(0, left - item.quantity);
        updates.push({ pref, sizes });
      }
    }

    updates.forEach(({ pref, sizes }) => {
      tx.update(pref, { sizes: JSON.stringify(sizes), quantity: sizes.reduce((n, s) => n + (Number(s.quantity) || 0), 0) });
    });

    if (stockProblems.length && order.status === 'paid') order.status = 'paid-needs-attention';
    order.stockProblems = stockProblems;
    tx.set(ref, order);
  });

  return order;
}

async function emailOrder(order) {
  try {
    const lines = order.cart.map((i) => `- ${i.productName} | size ${i.size} | x${i.quantity} | ZMW ${i.lineTotal}`).join('\n');
    const text = [
      `New Lumina order ${order.orderNumber}`,
      `Status: ${order.status}`,
      `Payment: ${order.paymentMethod}${order.reference ? ` (ref ${order.reference})` : ''}`,
      '',
      `Customer: ${order.customer.name || '-'}`,
      `Phone: ${order.customer.phone}`,
      `Email: ${order.customer.email || '-'}`,
      `Delivery: ${DELIVERY[order.delivery.method]}`,
      `Address: ${order.delivery.address || 'get it from the customer on WhatsApp'}${order.delivery.town ? `, ${order.delivery.town}` : ''}`,
      `Special packing: ${order.specialPacking ? 'YES - confirm fee on WhatsApp' : 'no'}`,
      `Note: ${order.note || '-'}`,
      '',
      'Items',
      lines,
      '',
      `Subtotal: ZMW ${order.subtotal}`,
      `Discount: ZMW ${order.discount}`,
      `Total: ZMW ${order.total}`,
      order.stockProblems && order.stockProblems.length ? `\nSTOCK PROBLEMS:\n${order.stockProblems.join('\n')}` : '',
      order.status === 'paid-unverified' ? '\nWARNING: payment was not verified with Lenco (LENCO_SECRET_KEY missing). Check your Lenco dashboard before sending.' : '',
    ].join('\n');
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: `New Lumina order ${order.orderNumber} (${order.status})`,
      text,
    });
  } catch (e) {
    console.error('order email failed:', e.message);
  }
}

function publicOrder(o) {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    paymentMethod: o.paymentMethod,
    reference: o.reference || null,
    customer: { name: o.customer.name },
    delivery: o.delivery,
    items: o.cart,
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    specialPacking: o.specialPacking,
    note: o.note,
  };
}

// POST /api/orders
// Card / mobile money: send after Lenco's onSuccess (or onConfirmationPending)
// with { reference }. Cash: send without a reference.
exports.createOrder = async (req, res) => {
  try {
    const o = readOrderBody(req.body);
    const err = validate(o);
    if (err) return res.status(400).json({ success: false, message: err });

    const quote = await quoteCart(o.cart);
    if (!quote.items.length) return res.status(400).json({ success: false, message: 'Your cart is empty.' });

    let status;
    let reference = null;
    let docId;

    if (o.paymentMethod === 'cash') {
      if (quote.problems.length) return res.status(409).json({ success: false, message: 'Some items have sold out.', problems: quote.problems });
      docId = `cod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      status = 'awaiting-cash';
    } else {
      reference = safeRef(req.body.reference);
      if (!reference) return res.status(400).json({ success: false, message: 'Missing payment reference.' });
      docId = reference;
      const v = await verifyCollection(reference);
      if (v.status === 'unverified') {
        status = 'paid-unverified';
      } else if (!v.verified) {
        status = 'payment-check-failed';
      } else if (v.status === 'successful') {
        if (v.amount + 0.01 < quote.total || (v.currency && v.currency !== 'ZMW')) {
          status = 'paid-wrong-amount';
        } else {
          status = 'paid';
        }
      } else if (v.status === 'failed') {
        return res.status(402).json({ success: false, message: 'Your payment did not go through. You have not been charged.' });
      } else {
        status = 'payment-pending';
      }
    }

    const order = {
      orderNumber: `LU-${String(reference || docId).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase()}`,
      status,
      paymentMethod: o.paymentMethod,
      reference,
      customer: o.customer,
      customerPhone: o.customer.phone, // kept for older reports
      delivery: o.delivery,
      note: o.note,
      specialPacking: o.specialPacking,
      cart: quote.items,
      subtotal: quote.subtotal,
      discount: quote.discount,
      total: quote.total,
      createdAt: new Date(),
    };

    // Stock is held for paid, unverified and cash orders. Pending payments
    // wait until you confirm them in Lenco.
    const reduceStock = ['paid', 'paid-unverified', 'paid-wrong-amount', 'awaiting-cash'].includes(status);
    const saved = await saveOrder(docId, order, { reduceStock });
    if (!saved.__alreadySaved) await emailOrder(saved);

    return res.status(201).json({ success: true, order: publicOrder(saved) });
  } catch (error) {
    console.error('create order error:', error);
    return res.status(500).json({ success: false, message: 'We could not save your order. If you paid, please message us on WhatsApp with your payment reference.' });
  }
};
