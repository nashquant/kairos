<img src="logo.svg" width="96" alt="Kairos logo">

# Kairos

Flashcards with spaced repetition. Each card comes back at the right moment (*kairos*), before you forget it.

**App:** https://nashquant.github.io/kairos/

Install on a phone: open the site, then Share → Add to Home Screen (iOS) or menu → Install app (Android). After the first visit it opens with no connection.

## Logo

The mark is the spaced-repetition sawtooth. Memory decays along the forgetting curve. Each bronze dot is a review at the right moment; it lifts recall back up, and the next decay is slower.

## Accounts, sync and private decks

Disabled since 2026-11-26: there is no Supabase project, so the app has no login and progress stays on the device. The sync and private-deck code is still in the repo (`web-src/adapter.js`, `supabase/schema.sql`, `scripts/encrypt_private.py`); `docs/spec.md` says how to reactivate it.

## Notebook

Study modules in `data/notes.json`, modelled on CFA prep: objectives → student-style note → one-screen summary → questions → cards. Multiple-choice questions are graded by the app (a miss comes back in the same session; FSRS sets the next day); open questions are self-graded. Cards link to the note section they came from (`note`), and after "Again" the app offers to reread it. Spec: `docs/spec.md`.

## Study filters

Under **Study filters**, turn a theme off to hide every card that has that tag. The choice stays on the device and applies to study and counts.

## How it works

- `app.html` is the app: one HTML page. `scripts/build_web.py` wraps it with the data adapter (`web-src/adapter.js`), the service worker and the manifest into `web/`. Each push to `main` builds, tests and deploys.
- Public cards: `data/decks.json`, `data/cards.json`. Claude adds cards by committing here; the spec is in [`docs/spec.md`](docs/spec.md).
- Every write goes to a local outbox first, so the app works offline and syncs later.
- Scheduling: FSRS-4.5 with default weights, plus Anki-style learning steps (1 min, 10 min; relearning 10 min).
- Cards support simple Markdown and LaTeX (`$…$`, `$$…$$`) through MathJax.

## Tests

`npm i --no-save jsdom@24 && pip install cryptography`, then `python3 scripts/build_web.py` and `node tests/web.test.js`, `node tests/offline.test.js`, `node tests/sync.test.js`, `node tests/flags.test.js`, `node tests/notes.test.js`, `python3 tests/test_ingest.py`.
