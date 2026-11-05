# Kairos — data spec and ingest rules

The website (https://nashquant.github.io/kairos/) is the app. Claude adds cards by committing to this repo; each push to `main` builds, tests and deploys. (The older claude.ai artifact is frozen; do not write to it.)

## Public vs private
- **Public decks** live in plain JSON: `data/decks.json` and `data/cards.json`. The repo is public: anyone can read them.
- **Private decks** live encrypted in `data/private/*.enc.json`, listed in `data/private/index.json`. Encrypt with `python3 scripts/encrypt_private.py <plain.json> <chunk-name>` using `data/public-key.json`. Only devices with the user's private key can read them. Never commit the plain JSON.
- Every new deck is **private by default**. Ask the user for visibility before creating a deck.
- Never put anything about the user's employer, clients, positions or internal material in a public deck, even if asked to make it public.
- Private chunks are append-only: to change or delete a private card, write a new chunk with the same id (later chunks win; `null` deletes). Claude cannot read existing private chunks.

## Data shape
- Deck: `{id: {name, desc, created}}`. `name` is hierarchical with `::`. Id is an ASCII slug.
- Card: `{id: {deck, front, back, tags[], source, created, suspended}}`. Id = `<deckId>-NNN`. New-card order = `created`, then id.
- `front`/`back`: simple Markdown (`**`, `*`, `` ` ``, fenced code, `- `/`1.` lists, `###`) and LaTeX `$…$` / `$$…$$` (MathJax).
- Progress (FSRS state, daily log, settings) stays on each device; Claude never writes it.

## Tags (fixed vocabulary, 1–3 per card; `datado` extra)
`fundamentos`, `medidas-de-risco`, `cva`, `hedge`, `netting`, `colateral`, `close-out`, `wrong-way`, `credito`, `juros`, `equity-fx`, `amc`, `simulacao`, `regulatorio`, `delta-one`, `datado` (practice that has since changed). New subjects may add tags; add a label in `TAG_LABELS` in `app.html`.

## Ingest rules
1. Confirm deck path and visibility with the user before creating a deck.
2. Read existing decks/cards first; no duplicates.
3. One fact per card. Specific question, short answer.
4. For formulas, ask for the intuition or the use, not only the form.
5. Validate: JSON loads, every formula compiles in MathJax, tests pass (`node tests/*.test.js`).
