#!/usr/bin/env node
/* The Vibe Dial's test: can the index place films on the dial's three axes, with no new data?
     npx wrangler dev --config tools/vibe/wrangler.toml --port 8790   (launch.json: vibe-ingest)
     node tools/vibe/dial-bench.mjs [--base http://127.0.0.1:8790] [--out tools/vibe/.cache/dial-bench.json]

   dial-films.json: 30 films, each labelled by hand on the axes where its place is obvious
   (mood -1 cozy, +1 intense · tone -1 funny, +1 serious · novelty -1 familiar, +1 experimental; 0 = not scored).

   Pass marks, fixed before the first run:
     1. Ordering: on each axis, at least 90% of (one pole, other pole) film pairs come out in the
        right order, using the declared method: `blend` (the embedding and the tags averaged), plus
        vote counts on novelty.
     2. Lists: with only that axis set to its end, the top 10 of the catalog must fit (GENRE_CHECKS).
     3. Movement: the two ends of an axis share at most 1 film in their top 10.
   Ordering is the clean result: nothing was tuned after it ran. The lists are not: the first run met
   every mark with poor lists (stand-up specials, shorts, The Grinch for "a heist"), so listFor() was
   changed after reading them. Check any later change with new queries, not these.
   Read-only: it calls the dev Worker's /embed, /films and /near. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDial, dialQuery, dialFilter, rankDial, tagScore, genresOf, tagsOf } from '../../functions/_lib/dial.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8790');
const OUT = opt('out', path.join(HERE, '.cache', 'dial-bench.json'));
const FILMS = JSON.parse(fs.readFileSync(path.join(HERE, 'dial-films.json'), 'utf8'));

const post = async (route, body) => {
  const r = await fetch(BASE + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(`${route}: ${d.error || r.status}`);
  return d;
};

// Each axis's poles as sentences to compare with a film's stored embedding (the ordering test only).
const AXES = {
  mood:    { neg: 'cozy', pos: 'intense', anchors: ['A cozy, gentle, comforting film that feels warm and safe, heartwarming and low-stakes.', 'An intense, tense, gripping film, harrowing and high-stakes, that keeps you on edge.'] },
  tone:    { neg: 'funny', pos: 'serious', anchors: ['A very funny comedy full of laughs, silly and lighthearted.', 'A serious, somber, weighty drama, grave and unsmiling.'] },
  novelty: { neg: 'familiar', pos: 'experimental', anchors: ['A crowd-pleasing mainstream blockbuster with a familiar, conventional story, easy to follow.', 'An experimental, avant-garde art film, surreal and unconventional, strange and challenging.'] },
};

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cos = (a, b) => dot(a, b) / Math.sqrt(dot(a, a) * dot(b, b));

const zs = list => {
  const mean = list.reduce((s, x) => s + x, 0) / list.length;
  const sd = Math.sqrt(list.reduce((s, x) => s + (x - mean) ** 2, 0) / list.length) || 1;
  return list.map(x => (x - mean) / sd);
};

function ordering(rows, scoreKey, axis) {
  const neg = rows.filter(r => r.film[axis] === -1), pos = rows.filter(r => r.film[axis] === 1);
  let right = 0; const wrong = [];
  for (const a of neg) for (const b of pos) {
    if (b[scoreKey][axis] > a[scoreKey][axis]) right++;
    else if (b[scoreKey][axis] === a[scoreKey][axis]) right += 0.5;
    else wrong.push(`${a.film.title} > ${b.film.title}`);
  }
  return { pct: right / (neg.length * pos.length), pairs: neg.length * pos.length, wrong };
}

async function listFor(dial, text) {
  const d = cleanDial(dial);
  const q = dialQuery(d, text);
  const [vec] = (await post('/embed', { texts: [q] })).vectors;
  const { matches } = await post('/near', { vector: vec, topK: 50, filter: dialFilter(d) });
  return { q, films: rankDial(matches, d, { text, limit: 10 }).map(x => ({ id: x.id, title: x.metadata.t, year: x.metadata.year, votes: x.metadata.votes, rating: x.metadata.rating, genres: genresOf(x.metadata), tags: tagsOf(x.metadata).slice(0, 5) })) };
}

const has = (f, gs) => f.genres.some(g => gs.includes(g));
const share = (films, test) => films.filter(test).length / films.length;
const GENRE_CHECKS = {
  'mood -2':    { label: 'no Horror, Thriller, War or Crime', min: 0.9, test: f => !has(f, ['Horror', 'Thriller', 'War', 'Crime']) },
  'mood 2':     { label: 'Thriller, Horror, War, Crime or Action', min: 0.8, test: f => has(f, ['Thriller', 'Horror', 'War', 'Crime', 'Action']) },
  'tone -2':    { label: 'Comedy', min: 0.8, test: f => has(f, ['Comedy']) },
  'tone 2':     { label: 'no Comedy', min: 0.9, test: f => !has(f, ['Comedy']) },
};

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  // 1. Ordering
  const got = new Map();
  for (let i = 0; i < FILMS.length; i += 20) {
    for (const f of (await post('/films', { ids: FILMS.slice(i, i + 20).map(x => x.id) })).films) got.set(f.id, f);
  }
  const missing = FILMS.filter(f => !got.has(f.id)).map(f => f.title);
  if (missing.length) console.log('NOT IN THE INDEX:', missing.join(', '));
  const axes = Object.keys(AXES);
  const anchorTexts = axes.flatMap(a => AXES[a].anchors);
  const anchors = (await post('/embed', { texts: anchorTexts })).vectors;
  const pole = (a, i) => anchors[axes.indexOf(a) * 2 + i];
  const rows = FILMS.filter(f => got.has(f.id)).map(film => {
    const g = got.get(film.id), row = { film, m: g.metadata, embed: {}, tags: {}, votes: {} };
    for (const a of axes) {
      row.embed[a] = cos(g.values, pole(a, 1)) - cos(g.values, pole(a, 0));
      row.tags[a] = tagScore(a, g.metadata);
    }
    row.votes.novelty = -Math.log10((g.metadata.votes || 0) + 1);
    return row;
  });
  const blend = {};
  for (const a of axes) {
    const ez = zs(rows.map(r => r.embed[a])), tz = zs(rows.map(r => r.tags[a]));
    const vz = a === 'novelty' ? zs(rows.map(r => r.votes.novelty)) : null;
    blend[a] = rows.map((_, i) => vz ? (ez[i] + tz[i] + vz[i]) / 3 : (ez[i] + tz[i]) / 2);
  }
  rows.forEach((r, i) => { r.blend = Object.fromEntries(axes.map(a => [a, blend[a][i]])); });

  const report = { ordering: {}, lists: {}, checks: [] };
  for (const a of axes) {
    const res = { embed: ordering(rows, 'embed', a), tags: ordering(rows, 'tags', a), blend: ordering(rows, 'blend', a) };
    if (a === 'novelty') res.votes = ordering(rows.map(r => ({ ...r, votes: { novelty: r.votes.novelty } })), 'votes', 'novelty');
    report.ordering[a] = res;
    console.log(`\n── ${a} (${AXES[a].neg} ↔ ${AXES[a].pos}), ${res.blend.pairs} pairs`);
    for (const [k, v] of Object.entries(res)) console.log(`  ${k.padEnd(6)} ${(v.pct * 100).toFixed(0)}%${v.wrong.length ? `   wrong: ${v.wrong.slice(0, 6).join('; ')}` : ''}`);
    console.log('  order: ' + rows.filter(r => r.film[a]).sort((x, y) => x.blend[a] - y.blend[a]).map(r => `${r.film.title} ${r.film[a] < 0 ? '(−)' : '(+)'}`).join(' · '));
  }

  // 2. Lists
  const settings = {
    'mood -2': { mood: -2 }, 'mood -1': { mood: -1 }, 'mood 1': { mood: 1 }, 'mood 2': { mood: 2 },
    'tone -2': { tone: -2 }, 'tone 2': { tone: 2 },
    'novelty -2': { novelty: -2 }, 'novelty 2': { novelty: 2 },
    'cozy+funny+familiar': { mood: -2, tone: -2, novelty: -2 },
    'intense+serious+experimental': { mood: 2, tone: 2, novelty: 2 },
    'cozy+serious': { mood: -2, tone: 2 },
    'intense+funny': { mood: 2, tone: -2 },
    'new: cozy+experimental': { mood: -2, novelty: 2 },
    'new: funny+experimental': { tone: -2, novelty: 2 },
    'new: slightly tense, slightly serious': { mood: 1, tone: 1 },
    'new: slightly cozy, slightly funny': { mood: -1, tone: -1 },
    'new: serious+familiar': { tone: 2, novelty: -2 },
  };
  const withText = [['a heist', { mood: -2 }], ['a heist', { mood: 2 }], ['space travel', { tone: -2 }], ['space travel', { tone: 2 }],
    // New for the build: not used while the ranking was tuned.
    ['a road trip', { mood: -2 }], ['a road trip', { mood: 2 }], ['a wedding', { tone: -2 }], ['a wedding', { tone: 2 }],
    ['a haunted house', { tone: -2 }], ['a haunted house', { novelty: 2 }], ['a dog', { mood: -1 }], ['a dog', { tone: 2 }]];
  for (const [name, d] of Object.entries(settings)) report.lists[name] = await listFor(d);
  for (const [text, d] of withText) report.lists[`"${text}" ${JSON.stringify(d)}`] = await listFor(d, text);
  console.log('\n── Lists');
  for (const [name, l] of Object.entries(report.lists)) console.log(`\n${name}\n   ${l.films.map(f => `${f.title} (${f.year})`).join(', ')}`);

  // 3. Checks
  const check = (name, ok, detail) => { report.checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };
  console.log('\n── Pass marks');
  for (const a of axes) { const v = report.ordering[a].blend; check(`ordering ${a}`, v.pct >= 0.9, `${(v.pct * 100).toFixed(0)}% of ${v.pairs} pairs`); }
  for (const [name, c] of Object.entries(GENRE_CHECKS)) { const s = share(report.lists[name].films, c.test); check(`list ${name}`, s >= c.min, `${(s * 100).toFixed(0)}% ${c.label} (needs ${c.min * 100}%)`); }
  const fam = median(report.lists['novelty -2'].films.map(f => f.votes)), exp = median(report.lists['novelty 2'].films.map(f => f.votes));
  check('list novelty', fam >= 5 * exp, `median votes ${fam} familiar vs ${exp} experimental (needs 5×)`);
  for (const a of axes) {
    const n = new Set(report.lists[`${a} -2`].films.map(f => f.id)), shared = report.lists[`${a} 2`].films.filter(f => n.has(f.id)).length;
    check(`movement ${a}`, shared <= 1, `${shared} films in both ends' top 10`);
  }
  report.rows = rows.map(r => ({ title: r.film.title, labels: { mood: r.film.mood, tone: r.film.tone, novelty: r.film.novelty }, votes: r.m.votes, tags: r.m.vt, embed: r.embed, tags_: r.tags, blend: r.blend }));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  const failed = report.checks.filter(c => !c.ok).length;
  console.log(`\n${report.checks.length - failed}/${report.checks.length} pass marks met. Full results: ${OUT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
