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
- **Deploy:** No Cloudflare Pages git integration. `git push origin main` alone does **not** deploy. After pushing, run `npx wrangler pages deploy . --project-name=ratingkino` to push changes live.
- **No build step.** Edit index.html directly. No framework, no bundler.
- **Local dev (static):** `python3 -m http.server 8282` — API calls won't work
- **Local dev (full):** `npx wrangler pages dev . --port 8282`

## Stop Hook Behaviour

After each agentic stop, a hook runs:
```bash
last_handoff != latest_commit → outputs reminder → Claude updates HANDOFF.md → commits → hook is silent → stop
```
The loop terminates naturally once HANDOFF.md is committed at HEAD.
