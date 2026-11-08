/**
 * Cloudflare Pages Function — /og/v2/<movie|tv>/<id>.jpg: a title's link-preview card.
 *
 * functions/index.js points og:image / twitter:image of a shared title at this
 * route. The card is 1200×630 (the 1.91:1 that X, Facebook, LinkedIn and Slack
 * show uncropped): the TMDB backdrop, darkened, behind the poster, the title in
 * the site's Montserrat, year · genres · runtime, and the FindFilm score with
 * its sources: 50% IMDb, 25% Rotten Tomatoes, 25% Metacritic (FFScore in assets/score.js).
 *
 * Pipeline: TMDB (+ OMDb for IMDb / Rotten Tomatoes / Metacritic) → an element
 * tree → satori (layout + text as paths → SVG) → resvg (SVG → RGBA pixels) →
 * mozjpeg (JPEG, ~100–200 KB, small enough for WhatsApp). The three WebAssembly
 * engines are bundled by wrangler from package.json's dependencies; the fonts
 * are static assets (assets/og/*.ttf, read through env.ASSETS).
 *
 * - A finished card is kept in KV for a week (`ogimg:<version>:<type>:<id>`) and in
 *   the colo's cache. To redraw them all, bump CARD_VERSION here and in
 *   functions/index.js, the share buttons' /og/ URL in both pages, and CARD_URL and
 *   CARD_KV in sync-worker.js. An older version's URL redirects to the current one.
 * - Missing pieces degrade: no backdrop → the brand gradient; no poster → the
 *   text takes the width; no score → a "coming" date or a plain tagline; a title
 *   the fonts can't draw (CJK, Arabic, …) is left off the card (og:title has it).
 * - Anything that fails (unknown id, adult title, TMDB down, a render error)
 *   redirects to the site's default card, which is never cached.
 */

import satori, { init as initSatori } from 'satori/wasm';
import initYoga from 'yoga-wasm-web';
import yogaWasm from 'yoga-wasm-web/dist/yoga.wasm';
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import encodeJpeg, { init as initJpeg } from '@jsquash/jpeg/encode.js';
import jpegWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';

const CARD_VERSION = 'v2';
const W = 1200, H = 630;
const TTL_SEC      = 7 * 86400;
const FALLBACK     = 'https://findfilm.ai/assets/og-image.jpg?v=f27f1f6e';
const IMG          = 'https://image.tmdb.org/t/p/';
const FONTS = [
  ['Montserrat', 700, 'Montserrat-Bold.ttf'],
  ['Montserrat', 900, 'Montserrat-Black.ttf'],
  ['Inter',      500, 'Inter-Medium.ttf'],
  ['Inter',      600, 'Inter-SemiBold.ttf'],
];
// What Montserrat and Inter can both draw: Latin (+ extended, Vietnamese),
// Cyrillic, punctuation and the usual symbols.
const DRAWABLE = /^[\u0000-\u024F\u0300-\u036F\u0400-\u04FF\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20BF\u2100-\u214F]*$/;

const INK    = '#0d0020';
const VIOLET = '#A78BFA';
const STAR   = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FBBF24" d="M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z"/></svg>');

export async function onRequestGet(context) {
  const { request, env, params, waitUntil } = context;
  const [version, type, file] = params.path || [];
  const id = /^(\d{1,10})\.jpg$/.exec(file || '')?.[1];
  if (!/^v\d+$/.test(version || '') || (type !== 'movie' && type !== 'tv') || !id) {
    return new Response('Not found', { status: 404 });
  }
  if (version !== CARD_VERSION) {   // an unfurl that kept an older image URL
    return Response.redirect(new URL(`/og/${CARD_VERSION}/${type}/${id}.jpg`, request.url).href, 301);
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/og/${version}/${type}/${id}.jpg`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const kvKey = `ogimg:${version}:${type}:${id}`;
  let jpeg = await env.MOVIES_CACHE?.get(kvKey, 'arrayBuffer').catch(() => null);
  if (!jpeg) {
    try {
      jpeg = await drawCard(env, request, type, id);
    } catch (err) {
      console.warn(`og card ${type}/${id}: ${err?.message || err}`);
      return Response.redirect(FALLBACK, 302);
    }
    if (!jpeg) return Response.redirect(FALLBACK, 302);
    waitUntil(env.MOVIES_CACHE?.put(kvKey, jpeg, { expirationTtl: TTL_SEC }).catch(() => {}));
  }

  const res = new Response(jpeg, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ── Engines and fonts: loaded once per isolate ─────────────────────────── */

// satori stays on 0.15: from 0.16 on it shapes text with HarfBuzz, whose
// Emscripten build compiles its embedded WebAssembly at runtime, and Workers
// only run WebAssembly that was bundled ahead of time.
let enginesReady = null;
function engines() {
  enginesReady ||= Promise.all([initYoga(yogaWasm).then(initSatori), initResvg(resvgWasm), initJpeg(jpegWasm)])
    .catch(err => { enginesReady = null; throw err; });
  return enginesReady;
}

let fontsReady = null;
function fonts(env, request) {
  fontsReady ||= Promise.all(FONTS.map(async ([name, weight, file]) => {
    const res = await env.ASSETS.fetch(new URL(`/assets/og/${file}`, request.url));
    if (!res.ok) throw new Error(`font ${file}: HTTP ${res.status}`);
    return { name, weight, style: 'normal', data: await res.arrayBuffer() };
  })).catch(err => { fontsReady = null; throw err; });
  return fontsReady;
}

/* ── The card ───────────────────────────────────────────────────────────── */

// → the JPEG as an ArrayBuffer, or null for a title that gets no card.
async function drawCard(env, request, type, id) {
  const d = await fetchJSON(`https://api.themoviedb.org/3/${type}/${id}?language=en-US&append_to_response=external_ids&api_key=${env.TMDB_KEY}`);
  const name = (type === 'tv' ? d?.name : d?.title) || '';
  if (!name || d.adult) return null;

  const imdbId = d.imdb_id || d.external_ids?.imdb_id;
  const [od, backdrop, poster, , fontList] = await Promise.all([
    imdbId ? fetchJSON(`https://www.omdbapi.com/?i=${imdbId}&apikey=${env.OMDB_KEY}`, 2500).catch(() => null) : null,
    d.backdrop_path ? imageData(IMG + 'w1280' + d.backdrop_path) : null,
    d.poster_path   ? imageData(IMG + 'w500'  + d.poster_path)   : null,
    engines(),
    fonts(env, request),
  ]);

  const svg = await satori(card({
    title: DRAWABLE.test(name) ? name : '',
    facts: facts(d, type),
    score: score(od, d),
    soon:  upcoming(d, type),
    backdrop, poster,
  }), { width: W, height: H, fonts: fontList });

  // resvg's objects live in WebAssembly memory: free them, or a warm isolate grows.
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false } });
  const image = resvg.render();
  try {
    const px = image.pixels;
    return await encodeJpeg({ data: new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), width: image.width, height: image.height },
                            { quality: 82 });
  } finally {
    image.free();
    resvg.free();
  }
}

// The element tree satori lays out. Plain objects: { type, props: { style, children } }.
function card({ title, facts, score, soon, backdrop, poster }) {
  const textWidth = poster ? 1072 - 334 - 56 : 1072;
  const size = title.length > 44 ? 50 : title.length > 26 ? 60 : 72;

  return h('div', { width: W, height: H, display: 'flex', position: 'relative', background: INK, fontFamily: 'Inter', color: '#fff' },
    backdrop
      ? h('img', { position: 'absolute', left: 0, top: 0, width: W, height: H, objectFit: 'cover' }, { src: backdrop, width: W, height: H })
      : h('div', { position: 'absolute', left: 0, top: 0, width: W, height: H,
                   backgroundImage: 'radial-gradient(circle at 75% 30%, #4c1d95 0%, #1e0a3c 45%, #0d0020 80%)' }),
    // The photo is darkened where the text sits; the brand gradient needs no veil.
    backdrop && h('div', { position: 'absolute', left: 0, top: 0, width: W, height: H,
               backgroundImage: 'linear-gradient(90deg, rgba(13,0,32,0.97) 0%, rgba(13,0,32,0.88) 45%, rgba(13,0,32,0.5) 100%)' }),
    backdrop && h('div', { position: 'absolute', left: 0, top: 0, width: W, height: H,
               backgroundImage: 'linear-gradient(0deg, rgba(13,0,32,0.85) 0%, rgba(13,0,32,0) 50%)' }),

    h('div', { position: 'absolute', left: 64, top: 64, width: 1072, height: 502, display: 'flex', alignItems: 'center' },
      poster && h('img', { width: 334, height: 501, borderRadius: 18, marginRight: 56, objectFit: 'cover',
                           boxShadow: '0 24px 64px rgba(0,0,0,0.65)', border: '2px solid rgba(255,255,255,0.14)' },
                  { src: poster, width: 334, height: 501 }),

      h('div', { width: textWidth, height: 501, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
        h('div', { display: 'flex', alignItems: 'center', fontFamily: 'Montserrat', fontWeight: 900, fontSize: 30, letterSpacing: -0.5 },
          h('span', {}, 'FindFilm'), h('span', { color: VIOLET }, '.ai')),

        h('div', { display: 'flex', flexDirection: 'column' },
          title && h('div', { display: 'block', fontFamily: 'Montserrat', fontWeight: 900, fontSize: size, lineHeight: 1.06,
                              letterSpacing: -1, lineClamp: 3, marginBottom: 20 }, title),
          facts && h('div', { display: 'flex', fontSize: 26, fontWeight: 500, color: 'rgba(255,255,255,0.74)' }, facts)),

        score ? scoreRow(score)
              : h('div', { display: 'flex', fontSize: 24, fontWeight: 600, color: VIOLET },
                  soon || 'Ratings · Trailer · Where to watch'))));
}

function scoreRow({ value, label, chips }) {
  return h('div', { display: 'flex', alignItems: 'center' },
    h('img', { width: 58, height: 58, marginRight: 14 }, { src: STAR, width: 58, height: 58 }),
    h('div', { display: 'flex', fontFamily: 'Montserrat', fontWeight: 900, fontSize: 76, lineHeight: 1, marginRight: 24 }, value),
    h('div', { display: 'flex', flexDirection: 'column' },
      h('div', { display: 'flex', fontSize: 17, fontWeight: 600, letterSpacing: 2.4, color: VIOLET, marginBottom: chips.length ? 10 : 0 },
        label.toUpperCase()),
      chips.length > 0 && h('div', { display: 'flex' },
        ...chips.map(([src, val]) => h('div', {
          display: 'flex', alignItems: 'center', marginRight: 10, padding: '6px 14px', borderRadius: 999,
          background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.16)', fontSize: 20, fontWeight: 600,
        }, h('span', { color: 'rgba(255,255,255,0.6)', marginRight: 8 }, src), h('span', {}, val))))));
}

// h(type, style, [extra props,] ...children) → a satori node; falsy children are
// dropped. A div is flex unless it says otherwise: satori lays out nothing else.
function h(type, style, ...rest) {
  const extra = rest.length && rest[0] && typeof rest[0] === 'object' && !rest[0].type ? rest.shift() : {};
  const children = rest.filter(c => c || c === 0);
  if (type === 'div' && !style.display) style = { display: 'flex', ...style };
  return { type, props: { ...extra, style, children: children.length === 1 ? children[0] : children } };
}

/* ── Facts ──────────────────────────────────────────────────────────────── */

// "2026 · Drama · History · 2h 8m" / "2011–2019 · Drama · 8 seasons"
function facts(d, type) {
  const parts = [];
  if (type === 'tv') {
    const from = (d.first_air_date || '').slice(0, 4);
    const to = (d.last_air_date || '').slice(0, 4);
    const ended = d.status === 'Ended' || d.status === 'Canceled';
    if (from) parts.push(ended && to && to !== from ? `${from}–${to}` : ended ? from : `${from}–`);
  } else if (d.release_date) {
    parts.push(d.release_date.slice(0, 4));
  }
  (d.genres || []).slice(0, 2).forEach(g => parts.push(g.name));
  if (type === 'tv' && d.number_of_seasons) {
    parts.push(`${d.number_of_seasons} season${d.number_of_seasons === 1 ? '' : 's'}`);
  } else if (d.runtime) {
    parts.push(d.runtime >= 60 ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : `${d.runtime}m`);
  }
  return parts.join('  ·  ');
}

// The site's own score (FFScore.value in assets/score.js): 50% IMDb, 25% Rotten
// Tomatoes, 25% Metacritic on a 10-point scale, a missing source left out and the
// others keeping their proportions; TMDB's user score when OMDb has none.
function score(od, d) {
  const srcs = [], chips = [];
  const imdb = parseFloat(od?.imdbRating);
  if (imdb > 0) {
    srcs.push({ v: imdb, w: 0.5 });
    chips.push(['IMDb', imdb.toFixed(1)]);
  }
  const rt = parseInt((od?.Ratings || []).find(r => r.Source === 'Rotten Tomatoes')?.Value, 10);
  if (rt > 0) { srcs.push({ v: rt / 10, w: 0.25 }); chips.push(['RT', `${rt}%`]); }
  const mc = parseInt(od?.Metascore, 10);
  if (mc > 0) { srcs.push({ v: mc / 10, w: 0.25 }); chips.push(['MC', String(mc)]); }

  if (srcs.length) {
    const avg = srcs.reduce((s, x) => s + x.v * x.w, 0) / srcs.reduce((s, x) => s + x.w, 0);
    return { value: avg.toFixed(1), label: 'FindFilm score', chips };
  }
  if (d.vote_average > 0 && d.vote_count >= 20) {
    return { value: d.vote_average.toFixed(1), label: 'TMDB user score', chips: [] };
  }
  return null;
}

// "In cinemas 6 Nov 2026" / "Premieres 6 Nov 2026" for a title that isn't out yet.
function upcoming(d, type) {
  const date = type === 'tv' ? d.first_air_date : d.release_date;
  if (!date || new Date(date) <= new Date()) return '';
  const when = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${type === 'tv' ? 'Premieres' : 'In cinemas'} ${when}`;
}

/* ── Fetch helpers ──────────────────────────────────────────────────────── */

async function fetchJSON(url, timeoutMs = 4000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return res.json();
}

// An image as a data: URI (satori embeds it in the SVG), or null.
async function imageData(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) return null;
    const mime = (res.headers.get('Content-Type') || 'image/jpeg').split(';')[0];
    if (mime !== 'image/jpeg' && mime !== 'image/png') return null;   // what resvg decodes
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}
