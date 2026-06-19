/**
 * FindFilm.ai — 301 Redirect Worker
 *
 * Deployed to the ratingkino.com Cloudflare zone.
 * Permanently redirects every request to the equivalent path on findfilm.ai,
 * preserving the full path and query string for SEO link equity.
 *
 * Examples:
 *   https://ratingkino.com/            → https://findfilm.ai/
 *   https://ratingkino.com/?movie=123  → https://findfilm.ai/?movie=123
 *   https://www.ratingkino.com/        → https://findfilm.ai/
 */
export default {
  fetch(request) {
    const url = new URL(request.url);
    const destination = `https://findfilm.ai${url.pathname}${url.search}`;
    return new Response(null, {
      status: 301,
      headers: {
        Location: destination,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  },
};
