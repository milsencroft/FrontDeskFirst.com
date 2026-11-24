// Sends mail from the Business 4 Gmail with the Gmail API using an OAuth refresh token (no passwords stored).
function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function buildMime({ from, to, subject, text }) {
  const encSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  return [`From: ${from}`, `To: ${to}`, `Subject: ${encSubject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text].join('\r\n');
}
export async function sendGmail(env, msg, fetchImpl = fetch) {
  if (!env.GMAIL_REFRESH_TOKEN) return { ok: false, skipped: 'gmail not configured' };
  const tok = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  if (!tok.ok) throw new Error(`gmail token HTTP ${tok.status}`);
  const { access_token } = await tok.json();
  const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(buildMime(msg)) }) });
  if (!res.ok) throw new Error(`gmail send HTTP ${res.status}`);
  return { ok: true, id: (await res.json()).id };
}
