/**
 * GET /api/paysera-callback?data=...&ss1=...
 * Paysera sends callback with data + ss1 (md5 signature)
 * We verify, then update order status in Supabase.
 *
 * Env vars needed:
 *   PAYSERA_SIGN_PASSWORD,
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const crypto = require('crypto');

function base64urlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function parseQS(qs) {
  const out = {};
  for (const part of qs.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = eq === -1 ? part : part.slice(0, eq);
    const v = eq === -1 ? '' : part.slice(eq + 1);
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  }
  return out;
}

module.exports = async function handler(req, res) {
  // Paysera sends GET with ?data=...&ss1=...
  const { data, ss1 } = req.query || {};

  if (!data) {
    return res.status(400).send('NO_DATA');
  }

  const password = process.env.PAYSERA_SIGN_PASSWORD;
  if (!password) {
    console.error('PAYSERA_SIGN_PASSWORD not set');
    return res.status(500).send('CONFIG_ERROR');
  }

  // Verify signature
  const expectedSign = md5(data + password);
  if (ss1 !== expectedSign) {
    console.error('Paysera signature mismatch');
    return res.status(400).send('INVALID_SIGN');
  }

  // Decode params
  let decoded;
  try {
    decoded = base64urlDecode(data);
  } catch (e) {
    return res.status(400).send('DECODE_ERROR');
  }

  const params = parseQS(decoded);
  const orderRef = params.orderid;
  const status = params.status; // 1 = paid, 2 = awaiting
  const amountCents = parseInt(params.amount || '0', 10);

  console.log('Paysera callback:', { orderRef, status, amountCents });

  // Update Supabase order status
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (supabaseUrl && supabaseKey && orderRef) {
    try {
      const isPaid = status === '1';
      const updateBody = JSON.stringify({
        status: isPaid ? 'apmaksats' : 'gaida_apmaksu',
      });

      const resp = await fetch(
        `${supabaseUrl}/rest/v1/sutijumi?ref=eq.${encodeURIComponent(orderRef)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: updateBody,
        }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('Supabase update failed:', resp.status, errText);
      } else {
        console.log(`Order ${orderRef} updated to ${isPaid ? 'apmaksats' : 'gaida_apmaksu'}`);
      }
    } catch (e) {
      console.error('Supabase update error:', e.message);
    }
  }

  // Paysera expects plain "OK" response
  return res.status(200).send('OK');
};
