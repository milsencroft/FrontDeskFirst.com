import { istDate, istParts, istMonth, slotKey, previousIstDay } from './lib/time.js';
import { budgetStatus } from './lib/budget.js';
import { alertOnce, resolveAlert, sendNtfy } from './lib/ntfy.js';
import { runJob } from './lib/jobs.js';
import { collectReportData, renderReport } from './lib/report.js';
import { sendGmail } from './lib/gmail.js';
import { verifySignature, recordCapturedPayment } from './lib/razorpay.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function handleEnquiry(request, env) {
  const ct = request.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
  const email = clean(data.email, 200);
  if (!clean(data.name) || !clean(data.clinic) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'name, clinic and a valid email are required' }, 400);
  if (!data.consent) return json({ ok: false, error: 'consent is required' }, 400);
  await env.DB.prepare('INSERT INTO inbound_leads (name, clinic, email, website, message, consent) VALUES (?, ?, ?, ?, ?, 1)')
    .bind(clean(data.name, 120), clean(data.clinic, 200), email, clean(data.website, 300), clean(data.message, 2000)).run();
  return json({ ok: true });
}

async function handleRazorpay(request, env) {
  const body = await request.text();
  if (!(await verifySignature(body, request.headers.get('x-razorpay-signature'), env.RAZORPAY_WEBHOOK_SECRET))) return json({ ok: false }, 401);
  const res = await recordCapturedPayment(env.DB, JSON.parse(body));
  return json({ ok: true, ...res });
}

export async function budgetCheck(env, now = new Date(), fetchImpl) {
  const month = istMonth(now);
  const row = await env.DB.prepare("SELECT COALESCE(SUM(amount_inr),0) AS amt FROM expenses WHERE substr(date,1,7) = ? AND status = 'paid'").bind(month).first();
  const s = budgetStatus({ budget: Number(env.MONTHLY_BUDGET_INR || 2000), spent: row.amt, claudeSubscription: Number(env.CLAUDE_SUBSCRIPTION_INR || 1999) });
  for (const t of s.crossed) {
    await alertOnce(env, env.DB, { key: `budget:${month}:${t}`, category: 'budget', title: `Budget ${t}% used`, message: `Business operating budget for ${month} is ${s.pct}% used. Remaining: INR ${s.remaining}.`, fetchImpl });
  }
  return s;
}

export async function healthCheck(env, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(env.SITE_URL, { method: 'GET' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await resolveAlert(env.DB, 'downtime:site');
    return { site: 'up' };
  } catch (e) {
    await alertOnce(env, env.DB, { key: 'downtime:site', category: 'downtime', title: 'Website down', message: `Website check failed: ${String(e.message || e)}`, fetchImpl });
    return { site: 'down' };
  }
}

export async function sendDailyReport(env, isoDay, fetchImpl) {
  const data = await collectReportData(env.DB, env, isoDay);
  const text = renderReport(data);
  const sent = await sendGmail(env, { from: env.REPORT_FROM, to: env.REPORT_TO, subject: `Business 4 — Daily Business Performance Report — ${isoDay}`, text }, fetchImpl);
  if (!sent.ok) throw new Error(sent.skipped || 'report not sent');
  return sent;
}

// Report job keyed by reporting date, so a missed 8 PM run is recovered later with its correct date.
export async function reportJob(env, isoDay, fetchImpl) {
  const res = await runJob(env.DB, { job: 'daily_report', slot: isoDay, fn: () => sendDailyReport(env, isoDay, fetchImpl) });
  if (res.ok === false) await alertOnce(env, env.DB, { key: `report:${isoDay}`, category: 'automation', title: 'Daily report failed', message: `The ${isoDay} report could not be sent after retries.`, fetchImpl });
  return res;
}

export async function onSchedule(cron, env, now = new Date(), fetchImpl) {
  if (cron === '*/15 * * * *') {
    const hb = await runJob(env.DB, { job: 'heartbeat', slot: slotKey(now), fn: async () => {
      const health = await healthCheck(env, fetchImpl);
      const budget = await budgetCheck(env, now, fetchImpl);
      // Recovery: if it's past 20:00 IST and today's report hasn't been sent, send it now; also catch up yesterday.
      const p = istParts(now), today = istDate(now);
      if (p.hh >= 20) await reportJob(env, today, fetchImpl);
      const y = previousIstDay(today);
      const yRow = await env.DB.prepare("SELECT status FROM job_runs WHERE key = ?").bind(`daily_report:${y}`).first();
      if (y >= (env.LAUNCH_DATE || '0000') && (!yRow || yRow.status !== 'done')) await reportJob(env, y, fetchImpl);
      return { health, budget };
    } });
    if (hb.ok === false && !hb.exhausted) await alertOnce(env, env.DB, { key: `heartbeat:${istDate(now)}`, category: 'automation', title: 'Scheduled checks failing', message: 'The 15-minute system check failed after retries.', fetchImpl });
    return hb;
  }
  if (cron === '30 14 * * *') return reportJob(env, istDate(now), fetchImpl);
  if (cron === '30 21 * * *') return runJob(env.DB, { job: 'nightly', slot: istDate(now), fn: async () => {
    const r = await env.DB.prepare("DELETE FROM job_runs WHERE job = 'heartbeat' AND started_at < datetime('now','-14 days')").run();
    return { pruned: r.meta.changes };
  } });
  return { ignored: cron };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/enquiry') return await handleEnquiry(request, env);
      if (request.method === 'POST' && url.pathname === '/webhooks/razorpay') return await handleRazorpay(request, env);
      if (url.pathname === '/health') return json({ ok: true });
      if (url.pathname === '/admin/budget') {
        if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false }, 401);
        return json(await budgetCheck(env));
      }
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      return json({ ok: false, error: 'server error' }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(onSchedule(event.cron, env, new Date(event.scheduledTime))); },
};
