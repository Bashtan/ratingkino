/* Tonight's Three: one Safe Bet, one Surprise, one Comfort Pick. No language model: the index holds
   each film's rating, votes, tags and a one-line feel written at ingest, and code does the choosing.

   Used by /api/tonight (functions/api/[[path]].js) and tools/vibe/tonight-bench.mjs, which tests it.
   No onRequest export, so Pages makes no route of this file.

   A role's rules relax step by step (LADDER), so there are always films to show. Each set of three
   has three different films, and its Surprise leads with a genre the other two don't. */

import { GENRE, genresOf, tagScore, NOT_A_PICK, ADULT, ATROCITY } from './dial.js';

export const TONIGHT_ROLES = ['safe', 'surprise', 'comfort'];
export const TONIGHT_SETS = 4;         // what "Show me three others" and already-rated films walk through
export const TONIGHT_CANDIDATES = 7;   // per role: enough to fill the sets once streamable films go first
const DRAW = 24;                       // the day's picks are drawn from this many best fits
const LEAD_CAP = 2;                    // or Comfort is all cartoons

const LADDER = {
  safe:     [{ votes: [5000], rating: 75 }, { votes: [2000], rating: 72 }, { votes: [500], rating: 68 }],
  surprise: [{ votes: [500, 20000], rating: 70 }, { votes: [300, 40000], rating: 66 }, { votes: [150], rating: 60 }],
  comfort:  [{ votes: [5000], rating: 70, notNew: true }, { votes: [2000], rating: 66, notNew: true }, { votes: [500], rating: 60 }],
};
export const TONIGHT_STEPS = 3;

// One phrase per role per day, so a daily visitor doesn't keep meeting the same films.
const FEELS = ['absorbing and beautifully made', 'gripping and unforgettable', 'smart, moving and rewarding', 'thrilling and satisfying', 'acclaimed and deeply loved', 'tense, clever and rewatchable', 'epic and spectacular'];
const SURPRISES = [
  'An original, unexpected and offbeat film.',
  'A strange, inventive story unlike anything you have seen.',
  'A hidden gem with a twist nobody sees coming.',
  'A bold, unconventional film from outside the mainstream.',
  'A quirky, clever film that defies its genre.',
  'A haunting, mind-bending story that stays with you.',
  'An under-the-radar film that critics adored.',
];
const COMFORTS = [
  'A film that is cozy, gentle, comforting and heartwarming.',
  'A warm, feel-good romantic comedy that leaves you smiling.',
  'A funny, lighthearted film that is easy to relax with.',
  'A nostalgic, uplifting adventure the whole family loves.',
  'A gentle, charming story about friendship and kindness.',
  'A sweet, comforting film you can watch again and again.',
  'A cheerful, whimsical film with a big heart.',
];
// The evening itself, when we know nothing about the visitor. Sunday first.
const EVENINGS = ['for a quiet Sunday evening', 'to settle into after a long day', 'to settle into after a long day', 'to unwind with on a weeknight', 'to unwind with on a weeknight', 'for a big night in', 'for a big night in'];

// day: 'YYYY-MM-DD'. taste: up to two TMDB genre ids.
export function tonightQueries(day, taste) {
  const stamp = Date.parse(`${day}T12:00:00Z`), n = Math.floor(stamp / 86400000);
  const feel = FEELS[n % FEELS.length], names = taste.map(id => GENRE[id]).filter(Boolean);
  return {
    safe: names.length ? `A ${names.join(' and ')} film that is ${feel}.` : `A film that is ${feel}, ${EVENINGS[new Date(stamp).getUTCDay()]}.`,
    surprise: SURPRISES[n % SURPRISES.length],
    comfort: COMFORTS[n % COMFORTS.length],
  };
}

export function tonightFilter(role, step, thisYear) {
  const rung = LADDER[role][step];
  const votes = { $gte: rung.votes[0] };
  if (rung.votes[1]) votes.$lte = rung.votes[1];
  const filter = { votes, rating: { $gte: rung.rating }, runtime: { $gte: 75, $lte: role === 'comfort' ? 140 : 170 } };
  if (rung.notNew) filter.year = { $lte: thisYear - 3 };
  return filter;
}

function allowed(role, m) {
  const g = genresOf(m), words = `${m.vt || ''}|${m.kw || ''}`.toLowerCase();
  if (!m.p || g.some(x => NOT_A_PICK.includes(x)) || ADULT.test(words)) return false;
  if (role !== 'comfort') return true;
  return !g.some(x => x === 'Horror' || x === 'War') && !ATROCITY.test(words) && tagScore('mood', m) < 0;
}

function roleScore(role, x, taste) {
  const m = x.metadata, rating = (m.rating || 0) / 100;
  const liked = String(m.g || '').split(',').some(id => taste.includes(Number(id))) ? 1 : 0;
  if (role === 'safe') return x.score * rating + liked * 0.1;
  if (role === 'comfort') return x.score - tagScore('mood', m) * 0.5 + rating * 0.3 + liked * 0.05;
  return x.score + rating * 0.3 + Math.max(0, tagScore('novelty', m)) * 0.3;
}

const leadOf = m => genresOf(m)[0] || '';

// A small seeded generator, so a day's picks are the same all evening.
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vectorize matches for one role → today's candidates, in the order they'd be offered.
export function tonightCandidates(role, matches, { seed, taste = [] }) {
  const ranked = matches.filter(x => allowed(role, x.metadata))
    .map(x => ({ x, s: roleScore(role, x, taste) }))
    .sort((a, b) => b.s - a.s).slice(0, DRAW).map(e => e.x);
  const rand = seeded(`${seed}|${role}`);
  for (let i = ranked.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ranked[i], ranked[j]] = [ranked[j], ranked[i]];
  }
  const lead = {}, out = [], spare = [];
  for (const x of ranked) {
    const g = leadOf(x.metadata);
    if (role !== 'safe' && (lead[g] || 0) >= LEAD_CAP) { spare.push(x); continue; }
    lead[g] = (lead[g] || 0) + 1;
    out.push(x);
  }
  return [...out, ...spare].slice(0, TONIGHT_CANDIDATES);
}

// Each role's candidates → the sets of three: { safe, surprise, comfort } per set, no film twice.
// streamable(x) moves a film the visitor can stream ahead of equally good ones.
export function tonightSets(byRole, { taste = [], streamable = () => false }) {
  const queue = {};
  for (const role of TONIGHT_ROLES) {
    const list = byRole[role] || [];
    queue[role] = [...list.filter(streamable), ...list.filter(x => !streamable(x))];
  }
  const used = new Set(), sets = [];
  const take = (role, ok = () => true) => {
    const pick = queue[role].find(x => !used.has(x.id) && ok(x)) || queue[role].find(x => !used.has(x.id));
    if (pick) used.add(pick.id);
    return pick;
  };
  const tasteLeads = new Set(taste.map(id => GENRE[id]));
  for (let i = 0; i < TONIGHT_SETS; i++) {
    const safe = take('safe'), comfort = take('comfort');
    const others = new Set([safe, comfort].filter(Boolean).map(x => leadOf(x.metadata)));
    const surprise = take('surprise', x => !others.has(leadOf(x.metadata)) && !tasteLeads.has(leadOf(x.metadata)));
    if (!safe || !comfort || !surprise) break;
    sets.push({ safe, surprise, comfort });
  }
  return sets;
}
