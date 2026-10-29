/**
 * FindFilm.ai — www → apex redirect Worker
 *
 * Bound to the Custom Domain www.findfilm.ai, which had no DNS record at all
 * (the address didn't load). Permanently redirects every request to the same
 * path and query on https://findfilm.ai, so shared links keep working.
 *
 * Examples:
 *   https://www.findfilm.ai/                 → https://findfilm.ai/
 *   https://www.findfilm.ai/?movie=603       → https://findfilm.ai/?movie=603
 *   http://www.findfilm.ai/cinematic/        → https://findfilm.ai/cinematic/
 */
export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(`https://findfilm.ai${url.pathname}${url.search}`, 301);
  },
};
