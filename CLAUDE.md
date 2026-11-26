# Kairos

Flashcards with spaced repetition (FSRS), served as a single-page PWA on GitHub Pages.

## Rules
- Language: everything in English — UI, content, code, comments, tests, docs, commit messages. Write in English even when the chat or source material is in Portuguese.
- Content rules (cards, decks, notes, tags, private decks, ids): read `docs/spec.md` before adding or changing data. It is the single source for those rules.
- Never rename an id (card, note, section, question, objective). Progress is keyed by it.
- `TAG_RENAME` in `app.html` keeps old Portuguese tag slugs on purpose: it migrates saved filters.
- A push to `main` deploys the app (`.github/workflows/pages.yml`). Push only with the user's approval.
- Log each working day in `WORKLOG.md`, in the same commit as the change.

## Layout
- `app.html`: the whole app. `web-src/`: data adapter, service worker, icons.
- `scripts/build_web.py`: builds `web/` (git-ignored) from `app.html` + `web-src/`.
- `data/`: public decks, cards, notes.
- `supabase/schema.sql`: auth, sync and private decks. Disabled since 2026-11-26 (no Supabase project); see `docs/spec.md`.

## Test
```bash
python3 -m venv .venv && .venv/bin/pip install cryptography   # once
npm i --no-save jsdom@24                                      # once
.venv/bin/python3 tests/test_data.py --base HEAD
.venv/bin/python3 scripts/build_web.py
for t in web offline sync flags notes; do node tests/$t.test.js; done
.venv/bin/python3 tests/test_ingest.py
```
