// Server-side pricing. Prices and stock always come from Firestore, never
// from the browser. Keep the discount rule in sync with website/src/config.js
const { db } = require('../config/firebase');

const DISCOUNT_THRESHOLD = 500;
const DISCOUNT_RATE = 0.1;

const round2 = (n) => Math.round(n * 100) / 100;

function parseSizes(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function sanitizeCart(cart) {
  if (!Array.isArray(cart)) return [];
  return cart
    .map((i) => ({ id: String(i.id || ''), size: String(i.size ?? ''), quantity: Math.floor(Number(i.quantity) || 0) }))
    .filter((i) => i.id && i.quantity > 0 && i.quantity <= 50)
    .slice(0, 50);
}

// Returns { items, subtotal, discount, total, problems }
async function quoteCart(rawCart) {
  const cart = sanitizeCart(rawCart);
  const items = [];
  const problems = [];

  for (const line of cart) {
    const snap = await db.collection('products').doc(line.id).get();
    if (!snap.exists) {
      problems.push({ id: line.id, size: line.size, available: 0, message: 'This item is no longer available.' });
      continue;
    }
    const product = snap.data();
    const sizes = parseSizes(product.sizes);
    const size = sizes.find((s) => String(s.size) === line.size);
    const available = size ? Number(size.quantity) || 0 : sizes.length === 0 ? Number(product.quantity) || 0 : 0;
    if (available < line.quantity) {
      problems.push({ id: line.id, size: line.size, available, productName: product.productName, message: available ? `Only ${available} left in size ${line.size}.` : 'Sold out in this size.' });
    }
    const price = Number(product.price) || 0;
    items.push({
      id: line.id,
      productName: product.productName,
      size: line.size,
      quantity: line.quantity,
      price,
      image: product.mainImage || '',
      lineTotal: round2(price * line.quantity),
    });
  }

  const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const discount = subtotal > DISCOUNT_THRESHOLD ? round2(subtotal * DISCOUNT_RATE) : 0;
  return { items, subtotal, discount, total: round2(subtotal - discount), problems };
}

module.exports = { quoteCart, parseSizes, sanitizeCart, round2 };
