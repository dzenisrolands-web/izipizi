/**
 * POST /api/pay
 * Body: { ref, amount_eur, email, name, phone }
 * Returns: { url } — Paysera redirect URL
 *
 * Env vars needed:
 *   PAYSERA_PROJECT_ID, PAYSERA_SIGN_PASSWORD,
 *   PAYSERA_MODE (live|test, default test)
 */
const crypto = require('crypto');

function base64url(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ref, amount_eur, email, name, phone } = req.body || {};

  if (!ref || !amount_eur) {
    return res.status(400).json({ error: 'Missing ref or amount_eur' });
  }

  const projectId = process.env.PAYSERA_PROJECT_ID;
  const password = process.env.PAYSERA_SIGN_PASSWORD;
  const mode = (process.env.PAYSERA_MODE || 'test').toLowerCase();

  if (!projectId || !password) {
    return res.status(500).json({ error: 'Paysera nav konfigurēts (trūkst PAYSERA_PROJECT_ID / PAYSERA_SIGN_PASSWORD)' });
  }

  // Determine base URL from request or env
  const baseUrl = process.env.SITE_URL || `https://${req.headers.host}`;

  const amountCents = Math.round(parseFloat(amount_eur) * 100);
  const [firstName, ...rest] = (name || '').split(/\s+/);

  const params = {
    projectid: projectId,
    orderid: ref,
    accepturl: `${baseUrl}/pasutit?status=ok&ref=${encodeURIComponent(ref)}`,
    cancelurl: `${baseUrl}/pasutit?status=cancel&ref=${encodeURIComponent(ref)}`,
    callbackurl: `${baseUrl}/api/paysera-callback`,
    amount: String(amountCents),
    currency: 'EUR',
    country: 'LV',
    version: '1.6',
    test: mode === 'live' ? '0' : '1',
    lang: 'LAT',
    paytext: `Sūtījums ${ref} — izipizi.lv`,
    p_email: email || '',
    p_firstname: firstName || '',
    p_lastname: rest.join(' '),
  };
  if (phone) params.p_phone = phone;

  const query = new URLSearchParams(params).toString();
  const data = base64url(query);
  const sign = md5(data + password);

  const payUrl = `https://www.paysera.com/pay/?data=${data}&sign=${sign}`;

  return res.status(200).json({ url: payUrl });
};
