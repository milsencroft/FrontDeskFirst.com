import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { istDate, istDayRangeUtc, slotKey } from '../src/lib/time.js';
import { budgetStatus, purchaseCheck } from '../src/lib/budget.js';
import { runJob } from '../src/lib/jobs.js';
import { verifySignature, recordCapturedPayment } from '../src/lib/razorpay.js';
import { collectReportData, renderReport } from '../src/lib/report.js';
import { onSchedule, budgetCheck, handleEnquiry } from '../src/index.js';
import { createHmac } from 'node:crypto';

const baseEnv = (db, extra = {}) => ({ DB: db, MONTHLY_BUDGET_INR: '2000', CLAUDE_SUBSCRIPTION_INR: '1999', REVENUE_TARGET_INR: '100000', LAUNCH_DATE: '2026-11-24', SITE_URL: 'https://example.test', NTFY_TOPIC: 'test-topic', ...extra });
const fakeFetch = (log, { siteOk = true, gmailOk = true } = {}) => async (url, opts = {}) => {
  log.push({ url: String(url), opts });
  if (String(url).startsWith('https://example.test')) return { ok: siteOk, status: siteOk ? 200 : 503 };
  if (String(url).includes('oauth2.googleapis.com')) return { ok: gmailOk, status: gmailOk ? 200 : 500, json: async () => ({ access_token: 't' }) };
  if (String(url).includes('gmail.googleapis.com')) return { ok: true, status: 200, json: async () => ({ id: 'm1' }) };
  return { ok: true, status: 200 };
};

test('IST date and day range', () => {
  assert.equal(istDate(new Date('2026-11-24T18:31:00Z')), '2026-11-25');
  assert.deepEqual(istDayRangeUtc('2026-11-25'), ['2026-11-24T18:30:00.000Z', '2026-11-25T18:30:00.000Z']);
  assert.equal(slotKey(new Date('2026-11-24T08:52:11Z')), '2026-11-24T08:45Z');
});

test('budget thresholds and purchase check', () => {
  const s = budgetStatus({ budget: 2000, spent: 1273, claudeSubscription: 1999 });
  assert.deepEqual(s.crossed, [50]); assert.equal(s.remaining, 727); assert.equal(s.totalCommitment, 3272);
  assert.equal(purchaseCheck({ budget: 2000, spent: 1273, cost: 800 }).allowed, false);
  assert.equal(purchaseCheck({ budget: 2000, spent: 1273, cost: 700 }).allowed, true);
});

test('jobs are idempotent per slot and exhaust without repeating dead letters', async () => {
  const db = makeDb(); let calls = 0;
  const ok = await runJob(db, { job: 'j', slot: 's1', fn: async () => ++calls });
  const again = await runJob(db, { job: 'j', slot: 's1', fn: async () => ++calls });
  assert.equal(ok.ok, true); assert.equal(again.skipped, true); assert.equal(calls, 1);
  const bad = await runJob(db, { job: 'k', slot: 's1', fn: async () => { throw new Error('boom'); } });
  const bad2 = await runJob(db, { job: 'k', slot: 's1', fn: async () => { throw new Error('boom'); } });
  assert.equal(bad.ok, false); assert.equal(bad.attempts, 3); assert.equal(bad2.exhausted, true);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM dead_letters').first()).n, 1);
});

test('job timeout counts as failure', async () => {
  const db = makeDb();
  const r = await runJob(db, { job: 't', slot: 's', retries: 1, timeoutMs: 20, fn: () => new Promise((r) => setTimeout(r, 200)) });
  assert.equal(r.ok, false); assert.match(r.error, /timeout/);
});

test('razorpay signature and idempotent payment recording', async () => {
  const body = JSON.stringify({ event: 'payment.captured', created_at: 1764000000, payload: { payment: { entity: { id: 'pay_1', amount: 2499500, fee: 58988, tax: 8998, currency: 'INR', notes: {} } } } });
  const sig = createHmac('sha256', 'secret').update(body).digest('hex');
  assert.equal(await verifySignature(body, sig, 'secret'), true);
  assert.equal(await verifySignature(body, sig, 'wrong'), false);
  const db = makeDb();
  assert.equal((await recordCapturedPayment(db, JSON.parse(body))).recorded, true);
  assert.equal((await recordCapturedPayment(db, JSON.parse(body))).recorded, false);
  const p = await db.prepare('SELECT amount, fee, tax_on_fee FROM payments').first();
  assert.deepEqual({ ...p }, { amount: 24995, fee: 500, tax_on_fee: 90 });
});

test('report separates collected revenue from invoices and reports zero honestly', async () => {
  const db = makeDb(); const env = baseEnv(db);
  await db.prepare("INSERT INTO invoices (amount, status) VALUES (14999, 'sent')").run();
  const text = renderReport(await collectReportData(db, env, '2026-11-24'));
  assert.match(text, /Revenue collected today: INR 0/);
  assert.match(text, /Outstanding invoices: INR 14,999 \(1\)/);
  assert.match(text, /Progress to INR 1,00,000 target: INR 0 collected \(0.0%\)/);
});

test('budget alerts fire once per threshold per month', async () => {
  const db = makeDb(); const log = []; const env = baseEnv(db);
  await db.prepare("INSERT INTO expenses (date, item, amount_inr, status) VALUES ('2026-11-24', 'domain', 1273, 'paid')").run();
  await budgetCheck(env, new Date('2026-11-24T09:00:00Z'), fakeFetch(log));
  await budgetCheck(env, new Date('2026-11-24T09:15:00Z'), fakeFetch(log));
  const ntfy = log.filter((l) => l.url.includes('ntfy.sh'));
  assert.equal(ntfy.length, 1); assert.match(ntfy[0].opts.headers.Title, /50%/);
});

test('daily report sends at 8 PM IST and recovers a missed day with its own date', async () => {
  const db = makeDb(); const log = [];
  const env = baseEnv(db, { GMAIL_REFRESH_TOKEN: 'r', GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', REPORT_FROM: 'b4@example.com', REPORT_TO: 'owner@example.com' });
  // Laptop/cloud offline on 24 Nov evening: no runs. Next day 21:00 IST heartbeat runs.
  await onSchedule('*/15 * * * *', env, new Date('2026-11-25T15:30:00Z'), fakeFetch(log));
  const sends = log.filter((l) => l.url.includes('messages/send')).map((l) => Buffer.from(JSON.parse(l.opts.body).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.equal(sends.length, 2);
  assert.ok(sends.some((m) => m.includes('Report — 2026-11-25')), 'today report'); assert.ok(sends.some((m) => m.includes('Report — 2026-11-24')), 'recovered report');
  const done = await db.prepare("SELECT key FROM job_runs WHERE job='daily_report' AND status='done' ORDER BY key").all();
  assert.deepEqual(done.results.map((r) => r.key), ['daily_report:2026-11-24', 'daily_report:2026-11-25']);
  // Running again does not resend.
  await onSchedule('30 14 * * *', env, new Date('2026-11-25T14:30:00Z'), fakeFetch(log));
  assert.equal(log.filter((l) => l.url.includes('messages/send')).length, 2);
});

test('site downtime alerts once and never includes secrets', async () => {
  const db = makeDb(); const log = []; const env = baseEnv(db, { RAZORPAY_WEBHOOK_SECRET: 'supersecret' });
  await onSchedule('*/15 * * * *', env, new Date('2026-11-24T09:00:00Z'), fakeFetch(log, { siteOk: false }));
  await onSchedule('*/15 * * * *', env, new Date('2026-11-24T09:15:00Z'), fakeFetch(log, { siteOk: false }));
  const ntfy = log.filter((l) => l.url.includes('ntfy.sh'));
  assert.equal(ntfy.length, 1); assert.ok(!JSON.stringify(ntfy).includes('supersecret'));
});

test('enquiry validation requires consent and valid email', async () => {
  const db = makeDb(); const env = baseEnv(db);
  const mk = (b) => new Request('https://x/api/enquiry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await handleEnquiry(mk({ name: 'A', clinic: 'B', email: 'bad' }), env)).status, 400);
  assert.equal((await handleEnquiry(mk({ name: 'A', clinic: 'B', email: 'a@b.co' }), env)).status, 400);
  assert.equal((await handleEnquiry(mk({ name: 'A', clinic: 'B', email: 'a@b.co', consent: 'on' }), env)).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM inbound_leads').first()).n, 1);
});
