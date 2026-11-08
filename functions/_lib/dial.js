/* The Vibe Dial's ranking: three sliders (Cozy ↔ Intense, Funny ↔ Serious, Familiar ↔ Experimental)
   with 5 stops each, -2 to 2. No language model: a stop is a fixed phrase to embed, and a film's place
   on an axis comes from what the index already holds (its vibe tags, genres and vote count).

   Used by /api/vibe-dial (functions/api/[[path]].js) and tools/vibe/dial-bench.mjs, which tests it.
   No onRequest export, so Pages makes no route of this file.

   With words typed, the words choose the candidates and the dial only orders them. Any dial word in
   the query drowns the words: the full phrases gave The Grinch for "a heist" + Cozy, and even one
   adjective ("A familiar film about Paris") gave The Princess and the Frog. */

const GENRE = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' };
export const genresOf = m => String(m.g || '').split(',').map(n => GENRE[n]).filter(Boolean);
export const tagsOf = m => String(m.vt || '').split('|').map(t => t.toLowerCase().trim()).filter(Boolean);

export const DIAL_KEYS = ['mood', 'tone', 'novelty'];

// Each axis's two ends as vocabularies, written from the catalog's most common tags.
export const DIAL_AXES = {
  mood: {
    tags: [['cozy', 'heartwarming', 'heartfelt', 'charming', 'uplifting', 'feel-good', 'feel good', 'family-friendly', 'family friendly', 'gentle', 'sweet', 'comforting', 'warm', 'whimsical', 'lighthearted', 'light-hearted', 'hopeful', 'holiday cheer', 'heartwarming story', 'rainy-day comfort', 'carefree', 'playful', 'lighthearted fun'],
           ['intense', 'thrilling', 'suspenseful', 'gripping', 'tense', 'gritty', 'violent', 'gory', 'disturbing', 'dark', 'harrowing', 'brutal', 'action-packed', 'action packed', 'fast-paced', 'fast paced', 'intense action', 'intense thriller', 'intense drama', 'chaotic', 'desperate', 'twisted', 'creepy', 'ominous', 'haunting', 'vengeful', 'dark atmosphere', 'creepy atmosphere']],
    genres: [{ Family: 1, Animation: 0.5, Romance: 0.5, Comedy: 0.5 }, { Horror: 1, Thriller: 1, War: 1, Crime: 0.5, Action: 0.5 }],
  },
  tone: {
    tags: [['funny', 'comedy', 'humorous', 'comical', 'witty', 'hilarious', 'quirky humor', 'offbeat humor', 'light-hearted', 'lighthearted', 'funny moments', 'satirical', 'satire', 'absurd', 'slapstick', 'comedy of errors', 'witty banter', 'campy', 'parody', 'spoof', 'lighthearted fun', 'gross-out', 'romantic comedy', 'fun'],
           ['tragic', 'emotional', 'dramatic', 'emotional depth', 'emotional turmoil', 'thought-provoking', 'somber', 'melancholic', 'bittersweet', 'historical drama', 'war drama', 'social commentary', 'true story', 'emotional drama', 'intense drama', 'harrowing', 'heartbreaking', 'grim', 'bleak', 'tear-jerker', 'tearjerker', 'drama', 'crime drama', 'psychological', 'disturbing']],
    genres: [{ Comedy: 1.5 }, { Drama: 0.5, War: 1, History: 1 }],
  },
  novelty: {
    tags: [['entertaining', 'blockbuster', 'crowd-pleaser', 'crowd pleaser', 'fun', 'heroic', 'classic', 'epic', 'family-friendly', 'family friendly', 'romantic comedy', 'superhero', 'action-packed', 'action packed', 'relatable', 'nostalgic'],
           ['surreal', 'experimental', 'avant-garde', 'mind-bending', 'unconventional', 'artistic', 'abstract', 'arthouse', 'art house', 'dreamlike', 'non-linear', 'nonlinear', 'existential', 'philosophical', 'bizarre', 'strange', 'trippy', 'hypnotic', 'psychedelic', 'enigmatic', 'cryptic', 'dreamlike state', 'unsettling']],
    genres: [{}, {}],
  },
};

export const DIAL_STOPS = {
  mood:    { '-2': 'cozy, gentle, comforting and heartwarming', '-1': 'warm and easygoing', 1: 'tense and gripping', 2: 'intense, harrowing, nail-biting and high-stakes' },
  tone:    { '-2': 'a laugh-out-loud funny comedy', '-1': 'light and playful', 1: 'thoughtful and earnest', 2: 'a serious, somber, weighty drama' },
  novelty: { '-2': 'a crowd-pleasing mainstream favorite', '-1': 'popular and accessible', 1: 'offbeat and unconventional', 2: 'an experimental, surreal art film' },
};

const NOT_A_PICK = ['Documentary', 'TV Movie'];   // stand-up specials and making-ofs read as "funny" and "serious"
const ADULT = /\b(erotic\w*|softcore|sexploitation|bdsm|sadomasochism|porn\w*|nymphomaniac)\b/;
const ATROCITY = /\b(nazi\w*|holocaust|concentration camp|genocide|slavery|auschwitz)\b/;   // "uplifting" and "hopeful" tags aren't cozy here

// -2 to 2 per axis; anything else is 0.
export function cleanDial(raw) {
  const d = {};
  for (const a of DIAL_KEYS) { const n = Number(raw?.[a]); d[a] = Number.isInteger(n) && Math.abs(n) <= 2 ? n : 0; }
  return d;
}

// One axis from what the film's tags and genres say: -1 (first end) to +1 (second end).
export function tagScore(axis, m) {
  const a = DIAL_AXES[axis], tags = tagsOf(m), g = genresOf(m);
  const side = i => tags.filter(t => a.tags[i].includes(t)).length + g.reduce((s, x) => s + (a.genres[i][x] || 0), 0);
  const n = side(0), p = side(1);
  return (p - n) / (p + n + 1);
}

export function dialQuery(d, text) {
  if (text) return `A film about ${text}.`;
  return `A film that is ${DIAL_KEYS.filter(a => d[a]).map(a => DIAL_STOPS[a][d[a]]).join(', ')}.`;
}

// The catalog limits for these stops. No shorts: their tags read cozy or strange too easily.
export function dialFilter(d, relaxed = false) {
  const votes = { $gte: relaxed ? 150 : 800 };
  if (d.novelty === -2) votes.$gte = relaxed ? 1500 : 5000;
  if (d.novelty === -1) votes.$gte = relaxed ? 500 : 1500;
  if (d.novelty === 2) { votes.$gte = 150; votes.$lte = 6000; }
  if (d.novelty === 1) { votes.$gte = 300; votes.$lte = 15000; }
  return { votes, rating: { $gte: relaxed ? 58 : 65 }, runtime: { $gte: 60 } };
}

// Vectorize matches → the picks, best first, at most `limit`.
export function rankDial(matches, d, { text = '', limit = 12 } = {}) {
  const leadCap = Math.ceil(limit * 0.3);   // or Cozy is all cartoons
  const allowed = m => {
    const g = genresOf(m), words = `${m.vt || ''}|${m.kw || ''}`.toLowerCase();
    if (g.some(x => NOT_A_PICK.includes(x)) || ADULT.test(words)) return false;
    if ((d.mood < 0 || d.novelty < 0) && g.includes('War')) return false;
    return !(d.mood < 0 && ATROCITY.test(words));
  };
  const scored = matches.filter(x => allowed(x.metadata)).map(x => {
    let fit = 0;
    for (const a of DIAL_KEYS) if (d[a]) fit += (d[a] / 2) * tagScore(a, x.metadata);
    const quality = (x.metadata.rating || 0) / 100 + Math.log10((x.metadata.votes || 0) + 1) / 8;
    return { x, fit, total: x.score * 3 + fit * (text ? 1.5 : 1) + quality };
  }).sort((a, b) => b.total - a.total);
  // With words typed, only films whose tags lean the dial's way: a shorter row beats a wrong film at its end.
  const agreeing = text ? scored.filter(s => s.fit >= 0.1) : scored;
  const pool = agreeing.length >= 6 ? agreeing : scored;
  const lead = {}, picks = [];
  for (const s of pool) {
    const g = genresOf(s.x.metadata)[0] || '';
    if ((lead[g] || 0) >= leadCap) continue;
    lead[g] = (lead[g] || 0) + 1;
    picks.push(s.x);
    if (picks.length === limit) break;
  }
  return picks;
}
