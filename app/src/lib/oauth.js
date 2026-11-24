// Gmail OAuth (web flow). The owner opens a one-time consent link; the callback stores the refresh token in D1.
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const redirectUri = (env) => `${env.SITE_URL}/oauth/callback`;

function randomState() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function createConsentLink(env) {
  if (!env.GMAIL_CLIENT_ID) throw new Error('GMAIL_CLIENT_ID not set');
  const state = randomState();
  await env.DB.prepare('INSERT INTO oauth_states (state) VALUES (?)').bind(state).run();
  const q = new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, redirect_uri: redirectUri(env), response_type: 'code', scope: GMAIL_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state });
  if (env.REPORT_FROM) q.set('login_hint', env.REPORT_FROM);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

// Returns { ok, message }. Only accepts a fresh state, and only the configured sender mailbox.
export async function handleCallback(env, url, fetchImpl = fetch) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code');
  const row = await env.DB.prepare("SELECT state FROM oauth_states WHERE state = ? AND created_at > datetime('now','-1 day')").bind(state).first();
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  if (!row) return { ok: false, message: 'This link has expired or was already used. Ask Claude for a new one.' };
  if (!code) return { ok: false, message: `Google did not grant access (${url.searchParams.get('error') || 'no code'}).` };
  const tok = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, redirect_uri: redirectUri(env), grant_type: 'authorization_code' }) });
  if (!tok.ok) return { ok: false, message: `Google token exchange failed (HTTP ${tok.status}).` };
  const t = await tok.json();
  if (!t.refresh_token) return { ok: false, message: 'Google did not return a long-lived token. Remove the app at myaccount.google.com/permissions and try a new link.' };
  if ((t.scope || '').split(' ').indexOf(GMAIL_SCOPE) === -1) return { ok: false, message: 'Send-email permission was not granted. Please tick it on the consent screen.' };
  const prof = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${t.access_token}` } });
  const email = prof.ok ? String((await prof.json()).emailAddress || '').toLowerCase() : '';
  if (env.REPORT_FROM && email !== String(env.REPORT_FROM).toLowerCase()) return { ok: false, message: `Please sign in as ${env.REPORT_FROM} (you signed in as ${email || 'an unknown account'}).` };
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('gmail_refresh_token', ?, datetime('now'))").bind(t.refresh_token).run();
  return { ok: true, message: `Connected ${email}. Daily reports will be sent from this mailbox.` };
}

export async function gmailRefreshToken(env) {
  if (env.GMAIL_REFRESH_TOKEN) return env.GMAIL_REFRESH_TOKEN;
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'gmail_refresh_token'").first();
  return row ? row.value : null;
}
