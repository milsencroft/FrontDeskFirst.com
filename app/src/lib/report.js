import { istDayRangeUtc, istMonth } from './time.js';
const inr = (n) => 'INR ' + Math.round(n || 0).toLocaleString('en-IN');
const one = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).first()) || {};

// Collects report figures for one IST day. Collected revenue = captured payments only.
export async function collectReportData(db, env, isoDay) {
  const [from, to] = istDayRangeUtc(isoDay);
  const month = isoDay.slice(0, 7);
  const today = await one(db, 'SELECT COALESCE(SUM(amount),0) AS amt, COUNT(*) AS n, COALESCE(SUM(fee+tax_on_fee),0) AS fees, COALESCE(SUM(refunded_amount),0) AS refunds FROM payments WHERE captured_at >= ? AND captured_at < ?', from, to);
  const cumulative = await one(db, 'SELECT COALESCE(SUM(amount),0) AS amt, COUNT(*) AS n, COALESCE(SUM(fee+tax_on_fee),0) AS fees, COALESCE(SUM(refunded_amount),0) AS refunds FROM payments WHERE captured_at < ?', to);
  const newClients = await one(db, 'SELECT COUNT(*) AS n FROM clients WHERE go_live_at >= ? AND go_live_at < ?', from, to);
  const totalClients = await one(db, "SELECT COUNT(*) AS n FROM clients WHERE status IN ('live','paid')");
  const leadsToday = await one(db, 'SELECT COUNT(*) AS n FROM inbound_leads WHERE created_at >= ? AND created_at < ?', from.replace('T', ' ').slice(0, 19), to.replace('T', ' ').slice(0, 19));
  const contacted = await one(db, "SELECT COUNT(*) AS n FROM prospects WHERE last_contact_at IS NOT NULL");
  const outstanding = await one(db, "SELECT COALESCE(SUM(amount),0) AS amt, COUNT(*) AS n FROM invoices WHERE status = 'sent'");
  const spentMonth = await one(db, "SELECT COALESCE(SUM(amount_inr),0) AS amt FROM expenses WHERE substr(date,1,7) = ? AND status = 'paid'", month);
  const spentToDate = await one(db, "SELECT COALESCE(SUM(amount_inr),0) AS amt FROM expenses WHERE date <= ? AND status = 'paid'", isoDay);
  const errors = await one(db, 'SELECT COUNT(*) AS n FROM dead_letters WHERE created_at >= ? AND created_at < ?', from.replace('T', ' ').slice(0, 19), to.replace('T', ' ').slice(0, 19));
  return { isoDay, today, cumulative, newClients: newClients.n || 0, totalClients: totalClients.n || 0, leadsToday: leadsToday.n || 0, contacted: contacted.n || 0, outstanding, spentMonth: spentMonth.amt || 0, spentToDate: spentToDate.amt || 0, errors: errors.n || 0,
    budget: Number(env.MONTHLY_BUDGET_INR || 2000), claude: Number(env.CLAUDE_SUBSCRIPTION_INR || 1999), target: Number(env.REVENUE_TARGET_INR || 100000) };
}

export function renderReport(d, { priorities = [], notes = [] } = {}) {
  const netCum = d.cumulative.amt - d.cumulative.fees - d.cumulative.refunds;
  const gross = netCum; // no delivery costs at present; WhatsApp fees are billed to clients by Meta
  const netProfit = gross - d.spentToDate;
  const conv = d.contacted ? ((d.totalClients / d.contacted) * 100).toFixed(1) + '%' : 'n/a (no outreach yet)';
  const pct = d.target ? ((d.cumulative.amt / d.target) * 100).toFixed(1) : '0';
  const lines = [
    `Business 4 — Daily Business Performance Report — ${d.isoDay}`, '',
    'ACTUAL COLLECTED REVENUE (captured payments only)',
    `1. Revenue collected today: ${inr(d.today.amt)} (${d.today.n} payments)`,
    `2. Cumulative collected since launch: ${inr(d.cumulative.amt)}`,
    `3. Total orders (payments): ${d.cumulative.n}`,
    `4. New paying customers today: ${d.newClients}`,
    `5. New qualified leads today: ${d.leadsToday}`,
    `6. Sales conversion rate (clients / clinics contacted): ${conv}`, '',
    'NOT YET COLLECTED',
    `7. Outstanding invoices: ${inr(d.outstanding.amt)} (${d.outstanding.n})`, '',
    'COSTS AND PROFIT',
    `8. Refunds to date: ${inr(d.cumulative.refunds)}`,
    `9. Marketing expenditure: INR 0 (no paid ads)`,
    `10. Operating expenses this month: ${inr(d.spentMonth)} of ${inr(d.budget)} budget (${inr(d.budget - d.spentMonth)} left)`,
    `    Claude subscription (separate): ${inr(d.claude)} / month`,
    `    Payment fees to date (cost of sales): ${inr(d.cumulative.fees)}`,
    `11. Gross profit to date: ${inr(gross)}`,
    `12. Net profit estimate to date (before Claude subscription): ${inr(netProfit)}`, '',
    'OPERATIONS',
    `13. Best-performing channel: personalised email (only channel live)`,
    `14. Campaign performance: ${d.contacted} clinics contacted to date`,
    `15. Customer support issues: none recorded`,
    `16. Tasks completed: see DAILY_REPORT.md`,
    `17. Problems encountered: ${d.errors ? d.errors + ' failed job(s) after retries' : 'none'}`,
    ...notes.map((n) => `    - ${n}`),
    `18. Tomorrow's priorities:`, ...(priorities.length ? priorities.map((p) => `    - ${p}`) : ['    - (set by morning review)']), '',
    `19. Progress to INR 1,00,000 target: ${inr(d.cumulative.amt)} collected (${pct}%)`,
  ];
  return lines.join('\n');
}
