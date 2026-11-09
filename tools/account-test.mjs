/* Tests accounts: token checks against locally made keys, and every route on the real schema.
     node tools/account-test.mjs
   Google can't be asked for a token here, so the routes get a stand-in for the provider check.
   Everything after that (cookies, sessions, cascades, limits) is the production code.
   The database is SQLite through tools/fake-d1.mjs. */
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, UnsecuredJWT } from 'jose';
import { verifyIdToken, handleAuth, handleMe } from '../functions/_lib/account.js';
import { fakeD1 } from './fake-d1.mjs';

const results = [];
const test = async (name, fn) => { await fn(); results.push(name); console.log('ok  ', name); };

/* ── Token checks ── */
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const other = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const keys = createLocalJWKSet({ keys: [jwk] });
const OK = { keys, issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: 'client-1', nonce: 'n-1' };
const sign = ({ claims = {}, iss = 'https://accounts.google.com', aud = 'client-1', exp = '1h', key = privateKey, kid = 'k1', sub = 'google-sub' } = {}) => {
  let t = new SignJWT({ nonce: 'n-1', email: 'a@b.c', ...claims }).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp);
  if (sub) t = t.setSubject(sub);
  return t.sign(key);
};
const rejects = (p, label) => assert.rejects(p, undefined, label);

await test('a good token passes', async () => assert.equal((await verifyIdToken(await sign(), OK)).sub, 'google-sub'));
await test('the other Google issuer spelling passes', async () => assert.ok(await verifyIdToken(await sign({ iss: 'accounts.google.com' }), OK)));
await test('a token meant for another site fails', async () => rejects(verifyIdToken(await sign({ aud: 'other' }), OK)));
await test('a token from another issuer fails', async () => rejects(verifyIdToken(await sign({ iss: 'https://evil.example' }), OK)));
await test('an expired token fails', async () => rejects(verifyIdToken(await sign({ exp: '-5m' }), OK)));
await test('a token signed by someone else fails', async () => rejects(verifyIdToken(await sign({ key: other.privateKey }), OK)));
await test('an unsigned token fails', async () => rejects(verifyIdToken(new UnsecuredJWT({ nonce: 'n-1', sub: 'x' }).setIssuer(OK.issuer[0]).setAudience('client-1').setExpirationTime('1h').encode(), OK)));
await test('a tampered token fails', async () => { const [h, p, s] = (await sign()).split('.'); const body = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'someone-else' })).toString('base64url'); await rejects(verifyIdToken(`${h}.${body}.${s}`, OK)); });
await test('a wrong nonce fails', async () => rejects(verifyIdToken(await sign({ claims: { nonce: 'other' } }), OK)));
await test('no nonce in the browser fails', async () => rejects(verifyIdToken(await sign(), { ...OK, nonce: '' })));
await test('no subject fails', async () => rejects(verifyIdToken(await sign({ sub: null }), OK)));
await test('rubbish fails', async () => rejects(verifyIdToken('not.a.token', OK)));

/* ── Routes on the real schema ── */
const db = fakeD1();
const env = { USERS: db };

const ORIGIN = 'https://findfilm.ai';
let ip = 0;   // each test its own address, so the sign-in limit only bites where it's meant to
function req(path, { method = 'GET', cookie = '', body, origin = ORIGIN, host = ORIGIN, address } = {}) {
  const headers = { 'CF-Connecting-IP': address || `10.0.0.${++ip}` };
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  return new Request(host + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
}
const verifyOk = claims => async (provider, token, nonce) => { assert.equal(nonce, 'nn'); return { sub: 'sub-1', email: 'me@x.y', name: 'Me', ...claims }; };
const auth = (path, opts, verify) => handleAuth({ request: req(`/api/auth/${path}`, opts), env, params: { path: [path] } }, verify);
const me = opts => handleMe({ request: req('/api/me', opts), env, params: {} });
const NONCE = '__Host-ff_nonce=nn';
const cookiesOf = res => res.headers.getSetCookie();
const sessionOf = res => cookiesOf(res).find(c => c.startsWith('__Host-ff_session=')).split(';')[0];
const signIn = (claims, address) => auth('google', { method: 'POST', cookie: NONCE, body: { credential: 'x' }, address }, verifyOk(claims));
const count = async table => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const wipe = async () => { await db.prepare('DELETE FROM users').run(); await db.prepare('DELETE FROM rate_limits').run(); };

await test('a guest is simply nobody', async () => assert.deepEqual(await (await me()).json(), { user: null }));

await test('nonce is a short-lived, script-proof cookie', async () => {
  const res = await auth('nonce');
  const { nonce } = await res.json();
  const c = cookiesOf(res)[0];
  assert.ok(nonce.length > 30 && c.includes(`__Host-ff_nonce=${nonce}`) && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c) && /Max-Age=600/.test(c));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

await test('signing in makes one account and a hashed session', async () => {
  await wipe();
  const res = await signIn();
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.equal(user.email, 'me@x.y');
  const c = cookiesOf(res).find(x => x.startsWith('__Host-ff_session='));
  assert.ok(/HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c) && /Path=\//.test(c) && !/Domain/.test(c));
  const token = sessionOf(res).split('=')[1];
  const row = await db.prepare('SELECT token_hash FROM sessions').first();
  assert.notEqual(row.token_hash, token);
  assert.equal([await count('users'), await count('identities'), await count('sessions')].join(), '1,1,1');
  assert.deepEqual((await (await me({ cookie: sessionOf(res) })).json()).user, user);
});

await test('the same person again is the same account, with fresh details', async () => {
  await wipe();
  const first = await (await signIn()).json();
  const second = await (await signIn({ email: 'new@x.y', name: undefined })).json();
  assert.equal(second.user.id, first.user.id);
  assert.equal(second.user.email, 'new@x.y');
  assert.equal(second.user.name, 'Me');
  assert.equal(await count('users'), 1);
});

await test('two first sign-ins at once make one account', async () => {
  await wipe();
  const [a, b] = await Promise.all([signIn(), signIn()]);
  assert.equal((await a.json()).user.id, (await b.json()).user.id);
  assert.equal(await count('users'), 1);
  assert.equal(await count('identities'), 1);
});

await test('a refused token creates nothing', async () => {
  await wipe();
  const res = await auth('google', { method: 'POST', cookie: NONCE, body: { credential: 'x' } }, async () => { throw new Error('bad'); });
  assert.equal(res.status, 401);
  assert.equal(await count('users'), 0);
  assert.equal(cookiesOf(res).some(c => c.startsWith('__Host-ff_session=')), false);
});

await test('another site can\'t post here', async () => {
  for (const origin of ['https://evil.example', '']) {
    assert.equal((await auth('google', { method: 'POST', cookie: NONCE, body: {}, origin }, verifyOk())).status, 403);
    assert.equal((await auth('logout', { method: 'POST', origin })).status, 403);
    assert.equal((await me({ method: 'DELETE', origin })).status, 403);
  }
});

await test('no CORS headers on any answer', async () => {
  for (const res of [await auth('nonce'), await me(), await signIn()]) assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

await test('ratingkino.com is refused, previews and localhost work', async () => {
  const host = 'https://ratingkino.com';
  assert.equal((await handleAuth({ request: req('/api/auth/nonce', { host, origin: host }), env, params: { path: ['nonce'] } })).status, 403);
  for (const h of ['https://auth.ratingkino.pages.dev', 'http://localhost:8283']) {
    assert.equal((await handleAuth({ request: req('/api/auth/nonce', { host: h, origin: h }), env, params: { path: ['nonce'] } })).status, 200);
  }
});

await test('localhost uses plain cookie names, without Secure', async () => {
  const h = 'http://localhost:8283';
  const res = await handleAuth({ request: req('/api/auth/nonce', { host: h, origin: h }), env, params: { path: ['nonce'] } });
  const c = cookiesOf(res)[0];
  assert.ok(c.startsWith('ff_nonce=') && !/Secure/.test(c));
});

await test('Apple is off until its id is set', async () => assert.equal((await auth('apple', { method: 'POST', cookie: NONCE, body: { credential: 'x' } }, verifyOk())).status, 404));
await test('an unknown route is a 404', async () => assert.equal((await auth('nope')).status, 404));
await test('too big a body is refused', async () => assert.equal((await auth('google', { method: 'POST', cookie: NONCE, body: 'x'.repeat(20000) }, verifyOk())).status, 400));

await test('the 21st attempt in ten minutes is refused', async () => {
  await wipe();
  const address = '10.9.9.9';
  for (let i = 0; i < 20; i++) assert.equal((await signIn({}, address)).status, 200);
  assert.equal((await signIn({}, address)).status, 429);
  assert.equal((await signIn({}, '10.9.9.10')).status, 200);
});

await test('signing out ends that session only', async () => {
  await wipe();
  const a = sessionOf(await signIn()), b = sessionOf(await signIn());
  const res = await auth('logout', { method: 'POST', cookie: a });
  assert.ok(cookiesOf(res)[0].includes('Max-Age=0'));
  assert.equal((await (await me({ cookie: a })).json()).user, null);
  assert.ok((await (await me({ cookie: b })).json()).user);
});

await test('an expired session is nobody, and is cleared', async () => {
  await wipe();
  const c = sessionOf(await signIn());
  await db.prepare('UPDATE sessions SET expires_at = 1').run();
  const res = await me({ cookie: c });
  assert.equal((await res.json()).user, null);
  assert.ok(cookiesOf(res)[0].includes('Max-Age=0'));
  assert.equal(await count('sessions'), 0);
});

await test('coming back after a day extends the session; within a day writes nothing', async () => {
  await wipe();
  const c = sessionOf(await signIn());
  assert.equal(cookiesOf(await me({ cookie: c })).length, 0);
  const old = Date.now() - 2 * 86400000;
  await db.prepare('UPDATE sessions SET last_seen_at = ?1, expires_at = ?2').bind(old, Date.now() + 1000000).run();
  const res = await me({ cookie: c });
  assert.ok(cookiesOf(res)[0].includes('__Host-ff_session='));
  assert.ok((await db.prepare('SELECT expires_at AS e FROM sessions').first()).e > Date.now() + 50 * 86400000);
});

await test('a made-up session cookie is nobody', async () => assert.equal((await (await me({ cookie: '__Host-ff_session=made-up' })).json()).user, null));

await test('deleting an account removes everything of theirs, and only theirs', async () => {
  await wipe();
  const mine = sessionOf(await signIn());
  const theirs = sessionOf(await signIn({ sub: 'sub-2', email: 'them@x.y' }));
  assert.equal(await count('users'), 2);
  const res = await me({ method: 'DELETE', cookie: mine });
  assert.equal(res.status, 200);
  assert.ok(cookiesOf(res)[0].includes('Max-Age=0'));
  assert.equal([await count('users'), await count('identities'), await count('sessions')].join(), '1,1,1');
  assert.equal((await (await me({ cookie: mine })).json()).user, null);
  assert.equal((await (await me({ cookie: theirs })).json()).user.email, 'them@x.y');
});

await test('deleting needs a session', async () => assert.equal((await me({ method: 'DELETE' })).status, 401));

console.log(`\nAll ${results.length} passed.`);
process.exit(0);
