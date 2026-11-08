# Kairos — data spec and ingest rules

The website (https://nashquant.github.io/kairos/) is the app. Claude adds cards by committing to this repo; each push to `main` builds, tests and deploys.

## Public vs private
- **Public decks** live in plain JSON: `data/decks.json` and `data/cards.json`. The repo is public: anyone can read them.
- **Private decks** live in Supabase (`private_docs`), readable only by the owner after login. To add them, Claude writes a plain chunk `{decks:{}, cards:{}}` (null deletes), encrypts it with `python3 scripts/encrypt_private.py <plain.json> <chunk-name>` (uses `data/ingest-public-key.json`) and commits `data/private/`. The "Ingest private decks" workflow decrypts it and writes to Supabase for `KAIROS_OWNER_EMAIL`. Never commit the plain JSON. Claude cannot read private decks back; to change a private card, send a new chunk with the same id.
- Every new deck is **private by default**. Ask the user for visibility before creating a deck.
- Never put anything about the user's employer, clients, positions or internal material in a public deck, even if asked to make it public.

## Accounts and sync
- Login is optional: Supabase Auth with a 6-digit email code. Without login, progress stays on the device.
- With login, progress (`reviews/*`, `log/*`, `config/settings`, own card edits) syncs through `user_docs`: newest write per document wins; daily logs merge entry by entry. Schema: `supabase/schema.sql`.
- Sign-out clears the device.

## Flagged cards (fix requests)
- In the app, the user flags a bad card (**Sinalizar**). It leaves study; the note says what is wrong. Public cards can no longer be deleted in the app, only flagged.
- The user pastes a list like `- id: <cardId> | <deck> | frente: … | problema: …`.
- To fix: edit that card **in place** in `data/cards.json` (same id). Any change to `front` or `back` resolves the flag on every device, and the card returns to study. To drop a useless card, set `"suspended": true` (keeps ids stable; never reuse an id).
- A flag stores a fingerprint of front+back, so changing only tags or source does not resolve it.

## Scheduling
- FSRS-4.5, default weights. Default learning steps: same-day repeats only after "Errei" (1 min) or "Difícil" (10 min); "Bom"/"Fácil" on a new card go straight to days (4 / 14 days at 90% retention). The Anki-style mode (1 min, 10 min) is a setting.

## Data shape
- Deck: `{id: {name, desc, created}}`. `name` is hierarchical with `::`. Id is an ASCII slug.
- Card: `{id: {deck, front, back, tags[], source, created, suspended, verified?, checkBy?}}`. New-card order = `created`, then id.
- `created` is an ordering key in ms, not a reliable date. Use `verified` for dates.
- `verified` (`YYYY-MM-DD`): the day Claude last checked the card's facts against a source. Set it on every new card and on every content change.
- `checkBy` (`YYYY-MM-DD`): only on time-sensitive facts (rules, regulation, product names, APIs, hardware specs). After that date the app shows "rever fatos". Recheck, then update `verified` and move `checkBy` forward, or tag `datado`.

## Card ids
- Id format for new cards: `<deckId>-NNN`, next free number in that deck. The prefix only records the deck the card was born in.
- An id is **permanent**: progress (`reviews/{id}`) and the user's edits hang on it. Moving a card to another deck, renaming a deck, rewording or retagging a card keep the id.
- Never reuse an id, and never delete a public card: set `suspended: true`. Deleting orphans progress.
- To refer to a card in chat or commits, use its id.
- `front`/`back`: simple Markdown (`**`, `*`, `` ` ``, fenced code, `- `/`1.` lists, `###`) and LaTeX `$…$` / `$$…$$` (MathJax).
- Progress (FSRS state, daily log, settings) belongs to each user; Claude never writes it.

## Tags (fixed vocabulary, 1–3 per card; `datado` extra)
`fundamentos`, `medidas-de-risco`, `cva`, `hedge`, `netting`, `colateral`, `close-out`, `wrong-way`, `credito`, `juros`, `equity-fx`, `amc`, `simulacao`, `regulatorio`, `datado` (practice that has since changed).
- Delta One: `delta-one` + `financiamento`, `hedge`, `dividendos`, `eventos-indice`, `produtos-d1`, `mesas`.
- LLM: `llm` + `transformers`, `treino-llm`, `inferencia`, `agentes`, `rag`, `mcp`, `langgraph`.
- System design: `system-design` + `escalabilidade`, `dados`, `confiabilidade`, `mensageria`, `seguranca-web`, `criptografia`, `design-patterns`, `web-app`, `trading-systems`.
- The domain tag (`delta-one`, `llm`, `system-design`) goes on every card of that domain, so one filter hides the whole subject. New subjects may add tags; add a label in `TAG_LABELS` in `app.html`.

## Ingest rules
1. Confirm deck path and visibility with the user before creating a deck.
2. Read existing decks/cards first; no duplicates.
3. One fact per card. Specific question, short answer.
4. For formulas, ask for the intuition or the use, not only the form.
5. Validate: `python3 tests/test_data.py` (schema, tags, ids, dates), JSON loads, every formula compiles in MathJax, tests pass (`node tests/web.test.js`, `offline`, `sync`; `python3 tests/test_ingest.py`).
