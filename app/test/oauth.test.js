import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { createConsentLink, handleCallback, gmailRefreshToken, GMAIL_SCOPE } from '../src/lib/oauth.js';

const env = (db) => ({ DB: db, SITE_URL: 'https://site.test', GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'sec', REPORT_FROM: 'frontdeskfirst@gmail.com' });
const google = (email, { refresh = 'r1', scope = GMAIL_SCOPE } = {}) => async (url) => {
  if (String(url).includes('oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'a', refresh_token: refresh, scope }) };
  return { ok: true, status: 200, json: async () => ({ emailAddress: email }) };
};
const cb = (link, code = 'c') => new URL(`https://site.test/oauth/callback?code=${code}&state=${new URL(link).searchParams.get('state')}`);

test('oauth callback stores refresh token once, only for the configured mailbox', async () => {
  const db = makeDb(), e = env(db);
  const link = await createConsentLink(e);
  assert.match(link, /redirect_uri=https%3A%2F%2Fsite.test%2Foauth%2Fcallback/);
  assert.match(link, /access_type=offline/);
  const wrong = await handleCallback(e, cb(link), google('someone@gmail.com'));
  assert.equal(wrong.ok, false);
  assert.equal(await gmailRefreshToken(e), null);
  const link2 = await createConsentLink(e);
  const ok = await handleCallback(e, cb(link2), google('FrontDeskFirst@gmail.com'));
  assert.equal(ok.ok, true);
  assert.equal(await gmailRefreshToken(e), 'r1');
  const replay = await handleCallback(e, cb(link2), google('frontdeskfirst@gmail.com'));
  assert.equal(replay.ok, false, 'state is single use');
});

test('oauth callback rejects unknown state and missing send scope', async () => {
  const db = makeDb(), e = env(db);
  assert.equal((await handleCallback(e, new URL('https://site.test/oauth/callback?code=c&state=nope'), google('frontdeskfirst@gmail.com'))).ok, false);
  const link = await createConsentLink(e);
  assert.equal((await handleCallback(e, cb(link), google('frontdeskfirst@gmail.com', { scope: 'openid' }))).ok, false);
});
