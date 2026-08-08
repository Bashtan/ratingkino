# FindFilm.ai — Project Instructions

Read `HANDOFF.md` at the start of every session for full context, architecture, and recent history.

---

## HANDOFF.md = Durable Project Memory

HANDOFF.md is the single source of truth across sessions. A Stop hook checks after every agentic turn whether HANDOFF.md is current — if it fires a reminder, update and commit before stopping.

### When to update

Update HANDOFF.md any time the session includes:
- New features, UI changes, or bug fixes to named functions
- New JS functions, CSS classes, or HTML IDs worth tracking
- Infrastructure / config / API changes
- Changes to the Pending / Next Steps checklist

### Update protocol

1. **Prepend a new session block** at the very top (right after `# RatingKino — Handoff`):

```md
---

## ⚡ Most Recent Session (YYYY-MM-DD) — [Session Theme]

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `<7-char hash>` | **Feature name** — key functions added/changed, CSS selectors, HTML IDs. |
```

2. **Update stale reference sections** as needed:
   - Key JS Functions Reference
   - CSS Architecture
   - Feed Architecture
   - Pending / Next Steps (check off completed items, add new ones)
   - File Structure (if files were added/removed)

3. **Commit and push** HANDOFF.md with the session's other changes, or as a standalone commit.

### What belongs in each commit row

- 7-char short hash
- Feature name in **bold**
- Named JS functions, CSS selectors (`.class`, `#id`), HTML element IDs that were added or changed
- Enough specificity that a fresh session can grep for the right function name without reading all 7 500 lines of index.html

---

## Key Project Facts

- **Production:** https://findfilm.ai — also https://ratingkino.com
- **Stack:** Single `index.html` (~7 500 lines) + `functions/api/[[path]].js` (Cloudflare Pages Function) + `sync-worker.js` (nightly cron)
- **Deploy:** No Cloudflare Pages git integration. `git push origin main` alone does **not** deploy. After pushing, run **`./deploy.sh`**.
  - **Never run `wrangler pages deploy .` again.** Deploying the repo root published `/.dev.vars` with the live TMDB and OMDB keys, plus `/sync-worker.js`, `/wrangler.toml` and `/schema.sql`. Pages has no exclusion mechanism — `.gitignore` does not apply to uploads and `.assetsignore` is a Workers-only feature that `pages deploy` silently ignores.
  - `deploy.sh` stages an explicit allowlist into `dist/`, refuses to ship if anything sensitive is staged, and after deploying **fetches the live URL** to confirm the sensitive paths really are unpublished. To add a public file, add it to `PUBLIC` in `deploy.sh` — nothing is published by default.
  - `./deploy.sh --stage-only` builds `dist/` without deploying.
- **No build step.** Edit `index.html` directly. No framework, no bundler. `dist/` is generated output — never edit or commit it.
- **Secrets:** `.dev.vars` (root: TMDB/OMDB) and `spotify-worker/.dev.vars`. Gitignored *and* blocked by the `.githooks/pre-commit` hook (`git config core.hooksPath .githooks`, already set).
- **Local dev (static):** `python3 -m http.server 8282` — API calls won't work
- **Local dev (full):** `./deploy.sh --stage-only && npx wrangler pages dev --port 8282`
  - No directory argument — it picks up `pages_build_output_dir = "dist"`, so local matches production exactly. Passing `.` re-exposes `.dev.vars` and `wrangler.toml` on localhost.

## Stop Hook Behaviour

After each agentic stop, a hook runs:
```bash
last_handoff != latest_commit → outputs reminder → Claude updates HANDOFF.md → commits → hook is silent → stop
```
The loop terminates naturally once HANDOFF.md is committed at HEAD.
