// All storage is UTC. Business dates and reports use Asia/Kolkata (UTC+05:30, no DST).
const IST_OFFSET_MIN = 330;
export function istParts(date = new Date()) {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}
const pad = (n) => String(n).padStart(2, '0');
export function istDate(date = new Date()) { const p = istParts(date); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
export function istMonth(date = new Date()) { return istDate(date).slice(0, 7); }
// UTC ISO range [start, end) covering one IST calendar day.
export function istDayRangeUtc(isoDay) {
  const start = new Date(Date.parse(`${isoDay}T00:00:00Z`) - IST_OFFSET_MIN * 60000);
  const end = new Date(start.getTime() + 86400000);
  return [start.toISOString(), end.toISOString()];
}
export function previousIstDay(isoDay) { return new Date(Date.parse(`${isoDay}T00:00:00Z`) - 86400000).toISOString().slice(0, 10); }
// 15-minute slot key, e.g. 2026-11-24T08:45Z
export function slotKey(date = new Date(), minutes = 15) {
  const ms = minutes * 60000; return new Date(Math.floor(date.getTime() / ms) * ms).toISOString().slice(0, 16) + 'Z';
}
