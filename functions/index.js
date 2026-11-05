/**
 * Cloudflare Pages Function for "/" — link previews for shared titles.
 *
 * A shared title is a deep link, /?movie=<id> or /?TVShows=<id> (Classic's
 * parseMediaDeepLink() and Cinematic's shareItem() in the pages). Telegram,
 * Facebook, iMessage, X, Slack and WhatsApp build their preview from the Open
 * Graph / Twitter Card tags without running JavaScript, so every shared title
 * used to preview as the site itself. For a deep link this rewrites those tags
 * in the static index.html (HTMLRewriter) with the title's name, year and plot
 * from TMDB, and points the image at its 1200×630 card (backdrop, poster and
 * FindFilm score, drawn by functions/og/[[path]].js). Every other request to
 * "/" passes straight through.
 *
 * - Every visitor gets the same HTML: no user-agent sniffing, so any crawler works.
 * - <title> is left alone: no page script resets it, so a visitor's tab would
 *   keep the film's name after closing it.
 * - TMDB's answer is kept in KV for a week (`og:v1:<type>:<id>`). A lookup slower
 *   than OG_WAIT_MS, an unknown id or an adult title serves the default tags;
 *   a slow lookup still lands in KV for the next crawler.
 */

const SITE        = 'https://findfilm.ai';
const CARD_VERSION = 'v1';                               // functions/og/[[path]].js's CARD_VERSION
const OG_TTL_SEC  = 7 * 86400;
const OG_WAIT_MS  = 1500;
const DESC_MAX    = 200;
const QUERY_KEY   = { movie: 'movie', tv: 'TVShows' };    // the pages' MEDIA_QUERY_KEY

export async function onRequest(context) {
  const { request, env } = context;
  const link = request.method === 'GET' ? deepLink(new URL(request.url)) : null;
  if (!link) return context.next();

  // A conditional request would come back 304 from the asset server before the
  // tags could be rewritten, so ask for the whole page.
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');

  const lookup = titleCard(env, link.type, link.id).catch(() => null);
  context.waitUntil(lookup.then(found => found?.put));
  const [page, found] = await Promise.all([
    context.next(new Request(request, { headers })),
    Promise.race([lookup, new Promise(resolve => setTimeout(() => resolve(null), OG_WAIT_MS))]),
  ]);
  const isHTML = (page.headers.get('Content-Type') || '').includes('text/html');
  if (!found || !page.ok || !isHTML) return page;

  const res = new Response(previewTags(found.card, link).transform(page).body, page);
  // The page's ETag names the static file, not this rewrite of it.
  res.headers.delete('ETag');
  res.headers.delete('Last-Modified');
  return res;
}

// First recognised key with a positive id, keys matched case-insensitively,
// exactly like parseMediaDeepLink() in index.html.
function deepLink(url) {
  for (const [key, val] of url.searchParams) {
    const type = Object.keys(QUERY_KEY).find(t => QUERY_KEY[t].toLowerCase() === key.toLowerCase());
    const id = parseInt(val, 10);
    if (type && id > 0 && Number.isSafeInteger(id)) return { type, id };
  }
  return null;
}

// → { card: { name, year, overview, poster }, put? } (put: the pending KV write), or null.
async function titleCard(env, type, id) {
  const key = `og:v1:${type}:${id}`;
  const hit = await env.MOVIES_CACHE?.get(key, 'json').catch(() => null);
  if (hit) return { card: hit };

  const res = await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=en-US&api_key=${env.TMDB_KEY}`);
  if (!res.ok) return null;
  const d = await res.json();
  const name = (type === 'tv' ? d.name : d.title) || '';
  if (!name || d.adult) return null;
  const card = {
    name,
    year:     ((type === 'tv' ? d.first_air_date : d.release_date) || '').slice(0, 4),
    overview: (d.overview || '').trim(),
    poster:   d.poster_path || '',
  };
  const put = env.MOVIES_CACHE?.put(key, JSON.stringify(card), { expirationTtl: OG_TTL_SEC }).catch(() => {});
  return { card, put };
}

function previewTags(card, link) {
  const title = card.year ? `${card.name} (${card.year})` : card.name;
  const content = {
    'meta[property="og:type"]':  link.type === 'tv' ? 'video.tv_show' : 'video.movie',
    'meta[property="og:url"]':   `${SITE}/?${QUERY_KEY[link.type]}=${link.id}`,
    'meta[property="og:title"]': title,
    'meta[name="twitter:title"]': title,
  };
  if (card.overview) {   // no plot: the site's own description stays
    const desc = clip(card.overview, DESC_MAX);
    content['meta[name="description"]'] = desc;
    content['meta[property="og:description"]'] = desc;
    content['meta[name="twitter:description"]'] = desc;
  }
  // The title's own 1200×630 card (functions/og/), drawn on first request.
  const image = `${SITE}/og/${CARD_VERSION}/${link.type}/${link.id}.jpg`;
  const alt = `${title}: poster and FindFilm score`;
  content['meta[property="og:image"]'] = image;
  content['meta[property="og:image:alt"]'] = alt;
  content['meta[name="twitter:image"]'] = image;
  content['meta[name="twitter:image:alt"]'] = alt;

  const rewriter = new HTMLRewriter();
  for (const [selector, value] of Object.entries(content)) {
    rewriter.on(selector, { element: el => el.setAttribute('content', value) });
  }
  return rewriter;
}

// At most `max` characters, cut at a word boundary when one is near the end.
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '') + '…';
}
