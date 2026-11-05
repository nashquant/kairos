# Kairos — data spec and ingest rules

Artifact: https://claude.ai/artifact/9SeXkRAzTV48Pn8nbqRGba (capability `db`).
Claude writes cards with the ArtifactData tool (`batch`, max 50 writes per call). Card changes never need a republish.

## Collections
- `decks/{deckId}` — `{name, desc, created}`. `name` is hierarchical with `::` (e.g. `Matemática::Álgebra Linear::Autovalores`). `deckId` is an ASCII slug.
- `cards/{cardId}` — `{deck, front, back, tags[], source, created, suspended}`. `cardId` = `<deckId>-NNN`. New-card order = `created`, then id. `front`/`back`: simple Markdown and LaTeX.
- `reviews/{cardId}` — FSRS state written by the page (`state, s, d, due, last, reps, lapses, step`). Claude does not write here.
- `log/{YYYY-MM-DD}` — `{entries:[{c,g,t,p}]}`, one doc per day (4 am rollover).
- `config/settings` — `{newPerDay, retention}`.

## Ingest rules
1. Confirm the deck path with the user before creating a new topic.
2. List existing decks and cards first; do not create duplicates.
3. One fact per card. Specific question, short answer.
4. For formulas, ask for the intuition or the use, not only the form.
5. Edit existing cards with `update` or `str_replace` and `if_version`.
