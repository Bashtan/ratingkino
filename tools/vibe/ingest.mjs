#!/usr/bin/env node
/* Fill the vibe-search index (Vectorize) with the most-voted TMDB films.
     node tools/vibe/ingest.mjs <phase> [--limit 50000] [--worker http://127.0.0.1:8790]
   phases, in order (or "all"):
     select    TMDB /discover, year by year, sorted by votes → the top --limit films
     details   /movie/{id} + keywords + credits for each (runtime, tagline, director, cast)
     tags      vibe tags + a "feel" line per film, 10 films per call (the Worker's /tags)
     upsert    one text per film → bge-m3 → Vectorize, with the card data as metadata.
               Only films with details and tags (--allow-untagged to override);
               --max N: only the N most-voted (e.g. the preview index, through
               the Worker run with --env preview on --worker http://127.0.0.1:8791).
               Progress is logged per index: upserted-<index the Worker is bound to>.txt
   "all" runs select only when there is no candidates.json yet (--reselect forces it).
   Needs the dev Worker running (tools/vibe/wrangler.toml; --env preview for the
   preview index) and TMDB_KEY in the repo's .dev.vars. Every phase appends to an
   NDJSON file in tools/vibe/.cache/ (gitignored) and skips what's already there,
   so an interrupted run picks up where it stopped. The metadata kept per film is
   what /api/vibe-search turns back into the TMDB rows the AI panel renders. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const PHASE = args[0] || 'all';
const LIMIT = Number(opt('limit', 50000));
const WORKER = opt('worker', 'http://127.0.0.1:8790');
const CACHE = path.resolve(opt('cache', path.join(HERE, '.cache')));
fs.mkdirSync(CACHE, { recursive: true });
const F = {
  candidates: path.join(CACHE, 'candidates.json'),
  details: path.join(CACHE, 'details.ndjson'),
  tags: path.join(CACHE, 'tags.ndjson'),
  genres: path.join(CACHE, 'genres.json'),
};

const TMDB_KEY = (fs.readFileSync(path.join(ROOT, '.dev.vars'), 'utf8').match(/^TMDB_KEY\s*=\s*"?([^"\n]+)"?/m) || [])[1];
if (!TMDB_KEY) throw new Error('no TMDB_KEY in .dev.vars');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readNd = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

// TMDB asks for ~40 requests/s at most: a simple spacing gate under that.
let nextSlot = 0;
async function tmdb(p, params = {}) {
  const u = new URL('https://api.themoviedb.org/3' + p);
  u.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 7; attempt++) {
    const now = Date.now(); const at = Math.max(now, nextSlot); nextSlot = at + 1000 / 35;
    if (at > now) await sleep(at - now);
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'FindFilm.ai ingest/1.0' } });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      await sleep((Number(r.headers.get('retry-after')) || 2 ** attempt) * 1000);
    } catch { await sleep(2 ** attempt * 500); }
  }
  throw new Error('TMDB failed: ' + p);
}

async function worker(route, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(WORKER + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (r.ok && !d.error) return d;
      if (attempt === 5) throw new Error(d.error || 'HTTP ' + r.status);
    } catch (e) { if (attempt === 5) throw e; }
    await sleep(1500 * 2 ** attempt);
  }
}

async function select() {
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: thisYear - 1899 }, (_, k) => 1900 + k);
  const base = { include_adult: 'false', include_video: 'false', language: 'en-US', sort_by: 'vote_count.desc' };
  let floor = 40, totals;
  for (;;) {      // the lowest vote floor that still holds ≥ LIMIT films
    totals = {};
    await pool(years, 12, async y => {
      const d = await tmdb('/discover/movie', { ...base, primary_release_year: y, 'vote_count.gte': floor, page: 1 });
      totals[y] = Math.min(d?.total_results || 0, 10000);
    });
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    log(`select: ${sum} films with ≥ ${floor} votes`);
    if (sum >= LIMIT || floor <= 5) break;
    floor = Math.max(5, Math.floor(floor * 0.7));
  }
  const pages = years.flatMap(y => Array.from({ length: Math.ceil(totals[y] / 20) }, (_, k) => [y, k + 1]));
  const rows = new Map();
  let done = 0;
  await pool(pages, 16, async ([y, page]) => {
    const d = await tmdb('/discover/movie', { ...base, primary_release_year: y, 'vote_count.gte': floor, page });
    for (const m of d?.results || []) rows.set(m.id, m);
    if (++done % 200 === 0) log(`select: ${done}/${pages.length} pages, ${rows.size} films`);
  });
  const top = [...rows.values()].sort((a, b) => b.vote_count - a.vote_count || a.id - b.id).slice(0, LIMIT);
  fs.writeFileSync(F.candidates, JSON.stringify(top));
  const g = await tmdb('/genre/movie/list', { language: 'en-US' });
  fs.writeFileSync(F.genres, JSON.stringify(Object.fromEntries((g?.genres || []).map(x => [x.id, x.name]))));
  log(`select: kept ${top.length} (votes ${top[top.length - 1]?.vote_count}–${top[0]?.vote_count})`);
}

async function details() {
  const cands = JSON.parse(fs.readFileSync(F.candidates, 'utf8'));
  const have = new Set(readNd(F.details).map(d => d.id));
  const todo = cands.filter(c => !have.has(c.id));
  log(`details: ${have.size} cached, ${todo.length} to fetch`);
  const out = fs.createWriteStream(F.details, { flags: 'a' });
  let done = 0;
  await pool(todo, 24, async c => {
    const d = await tmdb(`/movie/${c.id}`, { language: 'en-US', append_to_response: 'keywords,credits' });
    const row = {
      id: c.id,
      runtime: d?.runtime || 0,
      tagline: (d?.tagline || '').slice(0, 160),
      kw: (d?.keywords?.keywords || []).map(k => k.name).slice(0, 15),
      dir: (d?.credits?.crew || []).find(p => p.job === 'Director')?.name || '',
      cast: (d?.credits?.cast || []).slice(0, 3).map(p => p.name),
    };
    out.write(JSON.stringify(row) + '\n');
    if (++done % 1000 === 0) log(`details: ${done}/${todo.length}`);
  });
  await new Promise(r => out.end(r));
}

function films() {
  const cands = JSON.parse(fs.readFileSync(F.candidates, 'utf8'));
  const genres = JSON.parse(fs.readFileSync(F.genres, 'utf8'));
  const det = new Map(readNd(F.details).map(d => [d.id, d]));
  const tg = new Map(readNd(F.tags).map(t => [t.id, t]));
  return cands.map(c => ({ ...c, det: det.get(c.id), tag: tg.get(c.id), genreNames: (c.genre_ids || []).map(id => genres[id]).filter(Boolean) }));
}

async function tags() {
  for (let pass = 1; pass <= 3; pass++) {
    const todo = films().filter(f => !f.tag && f.det && f.overview && f.poster_path);   // details first (keywords)
    log(`tags pass ${pass}: ${todo.length} films to tag`);
    if (!todo.length) return;
    const batches = [];
    for (let k = 0; k < todo.length; k += 10) batches.push(todo.slice(k, k + 10));
    const out = fs.createWriteStream(F.tags, { flags: 'a' });
    let done = 0, failed = 0;
    await pool(batches, Number(opt('conc', 16)), async b => {   // --conc: Workers AI allows 300 calls/min; one call takes ~20s
      try {
        const res = await worker('/tags', {
          films: b.map(f => ({ id: f.id, title: f.title, year: (f.release_date || '').slice(0, 4), genres: f.genreNames, keywords: f.det?.kw || [], overview: f.overview })),
        });
        for (const [id, t] of Object.entries(res.tags || {})) out.write(JSON.stringify({ id: Number(id), ...t }) + '\n');
      } catch (e) { failed++; }
      if (++done % 100 === 0) log(`tags: ${done}/${batches.length} batches (${failed} failed)`);
    });
    await new Promise(r => out.end(r));
  }
  const left = films().filter(f => !f.tag && f.det && f.overview && f.poster_path).length;
  if (left) log(`tags: ${left} films still untagged after 3 passes (upsert skips them; run tags again)`);
}

const cut = (s, n) => (s || '').length > n ? s.slice(0, n - 1).trimEnd() + '…' : (s || '');

export function docText(f) {
  const y = (f.release_date || '').slice(0, 4);
  const d = f.det || {}, t = f.tag || {};
  return [
    `${f.title}${y ? ` (${y})` : ''}.`,
    f.genreNames.length ? `${f.genreNames.join(', ')}.` : '',
    d.tagline || '',
    f.overview || '',
    d.kw?.length ? `Themes: ${d.kw.slice(0, 12).join(', ')}.` : '',
    t.tags?.length ? `Vibe: ${t.tags.join(', ')}.` : '',
    t.feel || '',
    d.dir ? `Directed by ${d.dir}.` : '',
    d.cast?.length ? `Starring ${d.cast.join(', ')}.` : '',
  ].filter(Boolean).join(' ').slice(0, 2400);
}

function metadata(f) {
  const d = f.det || {}, t = f.tag || {};
  const m = {
    // indexed (filters): see the create-metadata-index calls in HANDOFF.md
    year: Number((f.release_date || '').slice(0, 4)) || 0,
    runtime: d.runtime || 0,
    rating: Math.round((f.vote_average || 0) * 10),
    votes: f.vote_count || 0,
    lang: f.original_language || '',
    // the TMDB row /api/vibe-search rebuilds for the AI panel, plus grounding for the reply
    t: f.title, d: f.release_date || '', g: (f.genre_ids || []).join(','),
    p: f.poster_path || '', b: f.backdrop_path || '', pop: Math.round((f.popularity || 0) * 10) / 10,
    o: cut(f.overview, 600), kw: (d.kw || []).slice(0, 12).join('|'), vt: (t.tags || []).join('|'),
    f: t.feel || '', dir: d.dir || '', cast: (d.cast || []).join('|'),
  };
  if (f.original_title && f.original_title !== f.title) m.ot = cut(f.original_title, 120);
  return m;
}

async function upsert() {
  // The log is named after the index the running Worker writes to, so the
  // production and preview runs can never skip each other's films.
  const info = await fetch(WORKER + '/info').then(r => r.json());
  if (!info.name) throw new Error('the Worker did not say which index it writes to (/info has no name)');
  const logFile = path.join(CACHE, `upserted-${info.name}.txt`);
  const have = new Set(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(Number) : []);
  const usable = films().filter(f => f.overview && f.poster_path);
  const all = args.includes('--allow-untagged') ? usable : usable.filter(f => f.det && f.tag);
  const max = Number(opt('max', 0));
  const todo = all.slice(0, max || all.length).filter(f => !have.has(f.id));
  log(`upsert → ${info.name} (${info.vectorCount} vectors): ${have.size} done, ${todo.length} to go; ${usable.length - all.length} skipped without details or tags`);
  const batches = [];
  for (let k = 0; k < todo.length; k += 50) batches.push(todo.slice(k, k + 50));
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  let done = 0;
  await pool(batches, 6, async b => {
    await worker('/upsert', { items: b.map(f => ({ id: f.id, text: docText(f), metadata: metadata(f) })) });
    out.write(b.map(f => f.id).join('\n') + '\n');
    if (++done % 50 === 0) log(`upsert: ${done}/${batches.length} batches`);
  });
  await new Promise(r => out.end(r));
}

const PHASES = { select, details, tags, upsert };
if (PHASE === 'all') {
  for (const p of ['select', 'details', 'tags', 'upsert']) {
    if (p === 'select' && fs.existsSync(F.candidates) && !args.includes('--reselect')) { log('select: keeping candidates.json (--reselect to redo)'); continue; }
    await PHASES[p]();
  }
}
else if (PHASES[PHASE]) await PHASES[PHASE]();
else { console.error('phase: select | details | tags | upsert | all'); process.exit(1); }
log('done:', PHASE);
