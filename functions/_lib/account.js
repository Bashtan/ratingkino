/* Accounts: sign-in with Google (and Apple, once it's switched on), sessions, sign-out, deletion.
   Used by functions/api/auth/[[path]].js and functions/api/me/[[path]].js. No onRequest export, so
   Pages makes no route of this file. Tests: tools/account-test.mjs.

   The browser gets a signed ID token from the provider and POSTs it here; it's checked against the
   provider's public keys, so no password or client secret exists anywhere. A session is a random
   token in an HttpOnly cookie, and only its hash is stored.

   These routes send no CORS headers (the main API allows any site; these must not), refuse a
   state-changing request from another origin, and answer only on findfilm.ai, localhost and
   *.ratingkino.pages.dev: ratingkino.com has its own browser storage, so nobody should sign in there.

   GET  /api/auth/nonce   → { nonce, google: the client id }, the nonce also set as a short-lived cookie. It goes into the sign-in,
                            comes back inside the token, and ties that token to this browser.
   POST /api/auth/google  { credential } → { user }, session cookie set
   POST /api/auth/apple   { credential, name? } → the same, while APPLE_CLIENT_ID is set; else 404
   POST /api/auth/logout  → { ok: true }
   GET  /api/me           → { user } or { user: null }
   DELETE /api/me         → { ok: true }: the account and everything of theirs
   POST /api/me/sync      merge saved data: functions/_lib/sync.js */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { syncRequest } from './sync.js';

export const GOOGLE_CLIENT_ID = '166585102182-p96f9a6e963b7dace3u0dum14bqav6kk.apps.googleusercontent.com';
export const APPLE_CLIENT_ID = '';   // the Services ID from the Apple Developer account. Empty: Apple sign-in is off.

const DAY = 86400000;
const SESSION_MS = 60 * DAY;
const NONCE_SECONDS = 600;
const MAX_BODY = 16384;              // an ID token is 1-2 KB
const MAX_FIELD = 200;               // a name or email we'd keep
const SIGN_INS_PER_WINDOW = 20, SYNCS_PER_WINDOW = 300, WINDOW_MS = 600000;

const PROVIDERS = {
  google: { keys: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')), issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: () => GOOGLE_CLIENT_ID },
  apple:  { keys: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')), issuer: 'https://appleid.apple.com', audience: () => APPLE_CLIENT_ID },
};

// The token's claims, or a throw. RS256 only: a token can't choose a weaker way of being checked.
export async function verifyIdToken(token, { keys, issuer, audience, nonce }) {
  const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'], clockTolerance: 30 });
  if (!nonce || payload.nonce !== nonce) throw new Error('nonce mismatch');
  if (!payload.sub) throw new Error('no subject');
  return payload;
}

function verifyWithProvider(provider, token, nonce) {
  const p = PROVIDERS[provider];
  return verifyIdToken(token, { keys: p.keys, issuer: p.issuer, audience: p.audience(), nonce });
}

/* ── Responses and cookies ── */
function json(body, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  cookies.forEach(c => headers.append('Set-Cookie', c));
  return new Response(JSON.stringify(body), { status, headers });
}

// __Host- cookies need https, so localhost uses plain names.
const cookieName = (url, base) => (url.protocol === 'https:' ? `__Host-${base}` : base);
function setCookie(url, base, value, seconds) {
  return `${cookieName(url, base)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${url.protocol === 'https:' ? '; Secure' : ''}`;
}
function readCookie(request, url, base) {
  const wanted = `${cookieName(url, base)}=`;
  const part = (request.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(wanted));
  return part ? part.slice(wanted.length) : '';
}
const sessionCookie = (url, token) => setCookie(url, 'ff_session', token, Math.floor(SESSION_MS / 1000));
const clearSession = url => setCookie(url, 'ff_session', '', 0);
const clearNonce = url => setCookie(url, 'ff_nonce', '', 0);

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Every request ── */
const allowedHost = host => host === 'findfilm.ai' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.ratingkino.pages.dev');

function refused(request, env) {
  const url = new URL(request.url);
  if (!allowedHost(url.hostname)) return json({ error: 'Not available here' }, 403);
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) return json({ error: 'Bad origin' }, 403);
  if (!env.USERS) return json({ error: 'Accounts unavailable' }, 503);
  return null;
}

async function overLimit(db, key, limit, now, waitUntil) {
  const id = `${key}:${Math.floor(now / WINDOW_MS)}`;
  const row = await db.prepare('INSERT INTO rate_limits (id, count, expires_at) VALUES (?1, 1, ?2) ON CONFLICT(id) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(id, now + 2 * WINDOW_MS).first();
  waitUntil?.(db.prepare('DELETE FROM rate_limits WHERE expires_at < ?1').bind(now).run().catch(() => {}));
  return row.count > limit;
}

const field = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_FIELD) : null);

// The person this token names, created on first sight. Two first sign-ins at once make one account.
async function findOrCreateUser(db, provider, claims, givenName, now) {
  const email = field(claims.email), name = field(claims.name) || field(givenName);
  const identity = () => db.prepare('SELECT user_id FROM identities WHERE provider = ?1 AND subject = ?2').bind(provider, claims.sub).first('user_id');
  let id = await identity();
  if (id) {
    // Apple sends the name only the first time, so what's missing now leaves what we have.
    await db.prepare('UPDATE users SET email = COALESCE(?2, email), name = COALESCE(?3, name) WHERE id = ?1').bind(id, email, name).run();
  } else {
    const fresh = crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)').bind(fresh, email, name, now),
      db.prepare('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(provider, subject) DO NOTHING').bind(provider, claims.sub, fresh, now),
    ]);
    id = await identity();
    if (id !== fresh) await db.prepare('DELETE FROM users WHERE id = ?1').bind(fresh).run();
  }
  return db.prepare('SELECT id, email, name FROM users WHERE id = ?1').bind(id).first();
}

async function signIn(request, env, provider, verify, waitUntil) {
  if (provider === 'apple' && !APPLE_CLIENT_ID) return json({ error: 'Not available' }, 404);
  const url = new URL(request.url), now = Date.now(), db = env.USERS;
  const address = await sha256(request.headers.get('CF-Connecting-IP') || 'local');
  if (await overLimit(db, `signin:${address}`, SIGN_INS_PER_WINDOW, now, waitUntil)) return json({ error: 'Too many attempts' }, 429);

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new Error('too long');
    body = JSON.parse(text);
  } catch { return json({ error: 'Bad request' }, 400); }

  let claims;
  try {
    claims = await verify(provider, String(body.credential || ''), readCookie(request, url, 'ff_nonce'));
  } catch (e) {
    console.log(`[auth] ${provider} token refused: ${e.code || e.message}`);
    return json({ error: 'Sign-in failed' }, 401, [clearNonce(url)]);
  }

  const user = await findOrCreateUser(db, provider, claims, body.name, now);
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)')
    .bind(await sha256(token), user.id, now, now + SESSION_MS).run();
  waitUntil?.(db.prepare('DELETE FROM sessions WHERE user_id = ?1 AND expires_at < ?2').bind(user.id, now).run().catch(() => {}));
  return json({ user }, 200, [sessionCookie(url, token), clearNonce(url)]);
}

// → { hash, token, user, stale } for this request's live session, or null.
async function currentSession(request, env, now) {
  const url = new URL(request.url), token = readCookie(request, url, 'ff_session');
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.USERS.prepare(
    'SELECT u.id, u.email, u.name, s.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1'
  ).bind(hash).first();
  if (!row) return null;
  if (row.expires_at <= now) {
    await env.USERS.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash).run();
    return null;
  }
  return { hash, token, user: { id: row.id, email: row.email, name: row.name }, stale: now - row.last_seen_at > DAY };
}

export async function handleAuth({ request, env, params, waitUntil }, verify = verifyWithProvider) {
  const stop = refused(request, env);
  if (stop) return stop;
  const url = new URL(request.url), route = (params.path || []).join('/');
  if (route === 'nonce' && request.method === 'GET') {
    const nonce = randomToken();
    return json({ nonce, google: GOOGLE_CLIENT_ID }, 200, [setCookie(url, 'ff_nonce', nonce, NONCE_SECONDS)]);
  }
  if ((route === 'google' || route === 'apple') && request.method === 'POST') {
    return signIn(request, env, route, verify, waitUntil);
  }
  if (route === 'logout' && request.method === 'POST') {
    const token = readCookie(request, url, 'ff_session');
    if (token) await env.USERS.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
    return json({ ok: true }, 200, [clearSession(url)]);
  }
  return json({ error: 'Not found' }, 404);
}

export async function handleMe({ request, env, params, waitUntil }) {
  const stop = refused(request, env);
  if (stop) return stop;
  const url = new URL(request.url), now = Date.now(), route = (params.path || []).join('/');

  if (route === 'sync') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const session = await currentSession(request, env, now);
    if (!session) return json({ error: 'Not signed in' }, 401);
    if (await overLimit(env.USERS, `sync:${session.user.id}`, SYNCS_PER_WINDOW, now, waitUntil)) return json({ error: 'Too many requests' }, 429);
    const [status, body] = await syncRequest(env.USERS, session.user.id, await request.text(), now);
    return json(body, status);
  }

  if (route) return json({ error: 'Not found' }, 404);

  if (request.method === 'GET') {
    const session = await currentSession(request, env, now);
    if (!session) return json({ user: null }, 200, readCookie(request, url, 'ff_session') ? [clearSession(url)] : []);
    if (!session.stale) return json({ user: session.user });
    // Coming back keeps you signed in. At most one write a day per session.
    await env.USERS.prepare('UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1').bind(session.hash, now, now + SESSION_MS).run();
    return json({ user: session.user }, 200, [sessionCookie(url, session.token)]);
  }

  if (request.method === 'DELETE') {
    const session = await currentSession(request, env, now);
    if (!session) return json({ error: 'Not signed in' }, 401);
    await env.USERS.prepare('DELETE FROM users WHERE id = ?1').bind(session.user.id).run();   // the rest cascades
    return json({ ok: true }, 200, [clearSession(url)]);
  }

  return json({ error: 'Method not allowed' }, 405);
}
