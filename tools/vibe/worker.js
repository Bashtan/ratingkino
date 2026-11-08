/* Dev-only ingest Worker for the vibe-search index (see wrangler.toml here).
   tools/vibe/ingest.mjs fetches the films from TMDB and calls these routes:

     POST /tags    {films: [{id, title, year, genres, keywords, overview}]}  ≤ 12 films
                   → {tags: {id: {tags: [...], feel: "..."}}}   (Workers AI, JSON mode)
     POST /upsert  {items: [{id, text, metadata}]}  ≤ 100 items
                   → embeds each text (bge-m3) and upserts vector "m<id>" with its metadata
     POST /query   {text, topK?, filter?}   a quick look at what the index returns
     POST /embed   {texts}                  → {vectors}  (bge-m3)
     POST /films   {ids}  ≤ 20              → {films: [{id, values, metadata}]}
     POST /near    {vector, topK?, filter?} → {matches: [{id, score, metadata}]}
     GET  /info    the bound index's name (INDEX_NAME) and description (dimensions, vector count)

   The prompts and the model names (film-doc.mjs) are the ingest half of the design in
   functions/api/[[path]].js (handleVibeSearch): change one, check the other. */
import { tagFilms, embed, vectorId } from './film-doc.mjs';

// The tag prompt, the models and the text and metadata of a film: film-doc.mjs,
// shared with the nightly ingest in sync-worker.js.
async function tags({ films }, env) {
  return { tags: await tagFilms(env.AI, films) };
}

async function upsert({ items }, env) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('items: 1-100');
  const vectors = await embed(env.AI, items.map(i => i.text));
  const rows = items.map((it, k) => ({ id: vectorId(it.id), values: vectors[k], metadata: it.metadata }));
  const res = await env.VECTORIZE.upsert(rows);
  return { count: rows.length, mutationId: res?.mutationId || null };
}

async function query({ text, topK = 10, filter }, env) {
  const [v] = await embed(env.AI, [text]);
  const r = await env.VECTORIZE.query(v, { topK, filter, returnMetadata: 'all' });
  return r.matches.map(m => ({ id: m.id, score: +m.score.toFixed(4), title: m.metadata?.t, year: m.metadata?.year, vibe: m.metadata?.vt }));
}

// Read-only, for tools/vibe/dial-bench.mjs.
async function films({ ids }, env) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 20) throw new Error('ids: 1-20');
  const rows = await env.VECTORIZE.getByIds(ids.map(vectorId));
  return { films: rows.map(v => ({ id: Number(String(v.id).slice(1)), values: Array.from(v.values), metadata: v.metadata })) };
}
async function near({ vector, topK = 50, filter }, env) {
  const r = await env.VECTORIZE.query(vector, { topK, returnMetadata: 'all', ...(filter ? { filter } : {}) });
  return { matches: r.matches.map(m => ({ id: Number(String(m.id).slice(1)), score: m.score, metadata: m.metadata })) };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/info') return Response.json({ name: env.INDEX_NAME, ...(await env.VECTORIZE.describe()) });
      if (request.method !== 'POST') return new Response('POST only', { status: 405 });
      const body = await request.json();
      if (pathname === '/tags') return Response.json(await tags(body, env));
      if (pathname === '/upsert') return Response.json(await upsert(body, env));
      if (pathname === '/query') return Response.json(await query(body, env));
      if (pathname === '/embed') return Response.json({ vectors: await embed(env.AI, body.texts) });
      if (pathname === '/films') return Response.json(await films(body, env));
      if (pathname === '/near') return Response.json(await near(body, env));
      return new Response('not found', { status: 404 });
    } catch (e) {
      return Response.json({ error: String(e && e.message || e) }, { status: 500 });
    }
  },
};
