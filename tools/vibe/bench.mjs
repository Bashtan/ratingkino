#!/usr/bin/env node
/* Run tools/vibe/bench-queries.json against both AI searches and save what each returned.
     node tools/vibe/bench.mjs [--base http://127.0.0.1:8283] [--out tools/vibe/.cache/bench.json] [--reuse-old <earlier bench.json>]
   For every query: POST /api/vibe-search?debug=1 (no cache) and /api/ai-search,
   one after the other, recording the top 6 films, FF Bot's message, `match`,
   and the wall time. Each film gets its runtime from TMDB (TMDB_KEY in .dev.vars)
   so constraint queries can be checked. Known-answer queries are scored here
   (rank of the right film); the rest are for judges (see HANDOFF.md). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8283');
const OUT = opt('out', path.join(HERE, '.cache', 'bench.json'));
const QUERIES = JSON.parse(fs.readFileSync(path.join(HERE, 'bench-queries.json'), 'utf8'));
const TMDB_KEY = (fs.readFileSync(path.join(ROOT, '.dev.vars'), 'utf8').match(/^TMDB_KEY\s*=\s*"?([^"\n]+)"?/m) || [])[1];
const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' };

const runtimes = new Map();
async function runtime(id) {
  if (runtimes.has(id)) return runtimes.get(id);
  const r = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}`).then(r => r.ok ? r.json() : null).catch(() => null);
  runtimes.set(id, r?.runtime || 0);
  return r?.runtime || 0;
}

async function ask(endpoint, q) {
  const t = Date.now();
  try {
    const r = await fetch(BASE + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, exclude: [] }), signal: AbortSignal.timeout(45000) });
    const d = await r.json();
    const ms = Date.now() - t;
    const movies = (d.movies || []).slice(0, 6);
    const films = [];
    for (const m of movies) {
      films.push({
        id: m.id, title: m.title, year: (m.release_date || '').slice(0, 4), lang: m.original_language,
        genres: (m.genre_ids || []).map(g => GENRES[g]).filter(Boolean), runtime: await runtime(m.id),
        overview: String(m.overview || '').slice(0, 260), reason: d.reasons?.[m.id] || '',
      });
    }
    return { ms, status: r.status, vibeSearch: !!d.vibeSearch, match: d.match || null, message: d.message || null, films, debug: d.debug || null, error: d.error || null };
  } catch (e) {
    return { ms: Date.now() - t, status: 0, error: String(e.message || e), films: [] };
  }
}

// --reuse-old <bench.json>: keep /api/ai-search's answers from an earlier run instead of asking again.
const reuse = opt('reuse-old') ? new Map(JSON.parse(fs.readFileSync(opt('reuse-old'), 'utf8')).map(r => [r.id, r.old])) : null;
const results = [];
for (const q of QUERIES) {
  const vibe = await ask('/api/vibe-search?debug=1', q.q);
  const old = reuse?.get(q.id) || await ask('/api/ai-search', q.q);
  const rank = r => q.answer ? (r.films.findIndex(f => q.answer.includes(f.id)) + 1) || 0 : null;
  results.push({ ...q, vibe: { ...vibe, rank: rank(vibe) }, old: { ...old, rank: rank(old) } });
  console.log(`${q.id.padEnd(9)} vibe ${String(vibe.ms).padStart(5)}ms ${vibe.vibeSearch ? '' : '(fell back) '}rank ${rank(vibe) ?? '-'} | old ${String(old.ms).padStart(5)}ms rank ${rank(old) ?? '-'} | ${vibe.films.slice(0, 3).map(f => f.title).join(' · ')}`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('saved', OUT);
