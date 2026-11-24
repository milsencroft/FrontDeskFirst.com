// Verifies Razorpay webhook signature: HMAC-SHA256(body, webhook secret) as hex.
export async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== signature.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
// Records a captured payment once (idempotent on razorpay_payment_id). Amounts in paise -> INR.
export async function recordCapturedPayment(db, event) {
  const p = event?.payload?.payment?.entity;
  if (!p || event.event !== 'payment.captured') return { ignored: true };
  const fee = Math.round((p.fee || 0) / 100), tax = Math.round((p.tax || 0) / 100);
  const invoiceId = p.notes && p.notes.invoice_id ? Number(p.notes.invoice_id) : null;
  const r = await db.prepare('INSERT OR IGNORE INTO payments (invoice_id, razorpay_payment_id, amount, fee, tax_on_fee, currency, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(invoiceId, p.id, Math.round(p.amount / 100), fee - tax, tax, p.currency, new Date((event.created_at || p.created_at || Date.now() / 1000) * 1000).toISOString()).run();
  if (invoiceId) await db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").bind(invoiceId).run();
  return { recorded: r.meta.changes === 1 };
}
