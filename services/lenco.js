// Confirms a payment with Lenco from the server, as Lenco recommends.
// Docs: https://lenco-api.readme.io/v2.0/reference/accept-payments
// Needs LENCO_SECRET_KEY in .env. For sandbox testing set
// LENCO_API_URL=https://sandbox.lenco.co/access/v2

const API_URL = process.env.LENCO_API_URL || 'https://api.lenco.co/access/v2';

// Returns { verified, status, amount, currency, type, raw } where status is
// Lenco's payment status ("successful", "pending", "failed", ...), or
// status "unverified" when no secret key is configured.
async function verifyCollection(reference) {
  const key = process.env.LENCO_SECRET_KEY;
  if (!key) {
    console.warn('LENCO_SECRET_KEY is not set: payment', reference, 'was NOT verified with Lenco.');
    return { verified: false, status: 'unverified' };
  }

  let res;
  let body;
  try {
    res = await fetch(`${API_URL}/collections/status/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    // Network problem reaching Lenco. The order is still saved (as
    // "payment-check-failed") so a paid order is never lost.
    const cause = err.cause ? ` (${err.cause.code || err.cause.message})` : '';
    console.error(`Could not reach Lenco to verify ${reference}: ${err.message}${cause}`);
    return { verified: false, status: 'lookup-failed', error: err.message };
  }
  if (!res.ok || !body || !body.data) {
    return { verified: false, status: 'lookup-failed', raw: body };
  }
  const d = body.data;
  return {
    verified: true,
    status: d.status,
    amount: Number(d.amount),
    currency: d.currency,
    type: d.type,
    lencoReference: d.lencoReference,
    raw: d,
  };
}

module.exports = { verifyCollection };
