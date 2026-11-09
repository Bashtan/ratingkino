/* Moving a guest's saved data from ratingkino.com to findfilm.ai. Two sites have two separate browser
   storages, so the data has to travel through the server, once. Browser side: assets/move.js.
   Used by functions/api/transfer/[[path]].js. No onRequest export, so Pages makes no route of this file.

     POST /api/transfer         on the old domain only. Any JSON object → { code }
     POST /api/transfer/claim   on the new domain only. { code } → that object, or 404

   The code is random, works once, and expires after eight minutes; sweepTransfers() in sync-worker.js
   deletes an expired one within the minute, which keeps the privacy page's ten minutes true. The server treats the payload as an
   opaque blob: the page that claims it checks every value before using it. Tests: tools/move-test.mjs. */

import { overLimit, sha256 } from './account.js';

const TTL_MS = 480000;
const MAX_BODY = 1500000;           // one bound value in D1 is at most 2 MB
const PER_WINDOW = 30;

const oldHost = h => h === 'ratingkino.com' || h === 'www.ratingkino.com' || h === 'old.localhost';
const newHost = h => h === 'findfilm.ai' || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.ratingkino.pages.dev');

function json(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function send(request, env, now, waitUntil) {
  const address = await sha256(request.headers.get('CF-Connecting-IP') || 'local');
  if (await overLimit(env.USERS, `move:${address}`, PER_WINDOW, now, waitUntil)) return json({ error: 'Too many requests' }, 429);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too much at once' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Bad request' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Bad request' }, 400);
  const code = randomCode();
  await env.USERS.prepare('INSERT INTO transfers (code_hash, payload, expires_at) VALUES (?1, ?2, ?3)').bind(await sha256(code), text, now + TTL_MS).run();
  waitUntil?.(env.USERS.prepare('DELETE FROM transfers WHERE expires_at < ?1').bind(now).run().catch(() => {}));
  return json({ code });
}

async function claim(request, env, now) {
  let code;
  try { code = String(JSON.parse(await request.text()).code || ''); } catch { return json({ error: 'Bad request' }, 400); }
  if (!/^[\w-]{20,100}$/.test(code)) return json({ error: 'Not found' }, 404);
  // One statement, so a code can only ever be claimed once.
  const row = await env.USERS.prepare('DELETE FROM transfers WHERE code_hash = ?1 AND expires_at > ?2 RETURNING payload').bind(await sha256(code), now).first();
  return row ? json(row.payload) : json({ error: 'Not found' }, 404);
}

export async function handleTransfer({ request, env, params, waitUntil }) {
  const url = new URL(request.url), route = (params.path || []).join('/');
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Bad origin' }, 403);
  if (!env.USERS) return json({ error: 'Unavailable' }, 503);
  if (route === '') return oldHost(url.hostname) ? send(request, env, Date.now(), waitUntil) : json({ error: 'Not available here' }, 403);
  if (route === 'claim') return newHost(url.hostname) ? claim(request, env, Date.now()) : json({ error: 'Not available here' }, 403);
  return json({ error: 'Not found' }, 404);
}
