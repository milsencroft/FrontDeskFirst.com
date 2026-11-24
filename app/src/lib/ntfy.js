// Sends an ntfy alert. Never include credentials, customer data or detailed financials in title/message.
export const CATEGORIES = { critical: 5, downtime: 5, security: 5, payment: 4, dispute: 4, approval: 4, budget: 4, automation: 4 };
export async function sendNtfy(env, { category, title, message, fetchImpl = fetch, retries = 3 }) {
  if (!env.NTFY_TOPIC) return { ok: false, skipped: 'no topic configured' };
  const priority = CATEGORIES[category] || 3;
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetchImpl(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
        method: 'POST', body: message,
        headers: { Title: `[B4] ${title}`, Priority: String(priority), Tags: category },
      });
      if (res.ok) return { ok: true, attempts: i + 1 };
      lastErr = `HTTP ${res.status}`;
    } catch (e) { lastErr = String(e && e.message || e); }
    await new Promise((r) => setTimeout(r, 200 * 2 ** i));
  }
  return { ok: false, error: lastErr };
}
// Send each alert_key at most once until resolved (no repeated alerts for the same issue).
export async function alertOnce(env, db, { key, category, title, message, fetchImpl }) {
  const existing = await db.prepare('SELECT alert_key FROM alerts WHERE alert_key = ? AND resolved_at IS NULL').bind(key).first();
  if (existing) return { ok: true, deduped: true };
  const res = await sendNtfy(env, { category, title, message, fetchImpl });
  if (res.ok) await db.prepare("INSERT OR REPLACE INTO alerts (alert_key, category, first_sent_at, resolved_at) VALUES (?, ?, datetime('now'), NULL)").bind(key, category).run();
  return res;
}
export async function resolveAlert(db, key) {
  await db.prepare("UPDATE alerts SET resolved_at = datetime('now') WHERE alert_key = ? AND resolved_at IS NULL").bind(key).run();
}
