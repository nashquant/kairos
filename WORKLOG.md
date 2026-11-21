# Worklog

Newest first. One entry per working day: what changed, the decisions behind it, and the commits.
Changes that git does not see (Supabase data, private decks) go here too.

## 2026-11-21

- Decision: the Cesari decks stay (the user knows the book). Plan: notes for every deck that has none — System Design (8), Cesari (7, from the book PDF the user will provide) and llm-02/05. Pilot first: `sd-01-scale`, then the user checks format and depth before the rest.
- New note `sd-01-scale` (8 sections, 12 questions), one worked example throughout: a link shortener at 100 million redirects/day. Every number recomputed in Python, including the 4 → 5 node remap (mod n moves 80%; a 200-vnode ring moved ~23%). The 19 `sd-01-scale` cards now point to its sections (`note` field).
- The note renderer has no tables: use bullet lists in note bodies.

## 2026-11-20

- New public deck `prob-01-bayes` (Math › Probability › 01 Bayes' theorem) with note `prob-01-bayes-dice`: Bayes' theorem through the two-dice casino puzzle (fair die vs a die that never rolls a 6; roll 1, switch 5, a 6 pays 20). Six objectives, eight sections, summary, 10 questions (9 multiple choice, 1 open). No cards yet: per the spec, cards come from missed questions. No new tags (notes carry none).
  - Numbers checked by running them: posteriors, one-roll update (checked equal to the batch formula for d in −20…20), and the decision result by value iteration on |d| ≤ 80 (switch at d = 9, never quit, V(0) ≈ 3.634). Every formula compiles in MathJax (144).
  - Visibility public because notes only support public decks; nothing employer-related.
- Finished the English pass started in `a7b3376`:
  - Objective verbs in `data/notes.json`: `definir/explicar/calcular/comparar/diagnosticar` → `define/explain/calculate/compare/diagnose` (`OBJ_VERBS`, `tests/test_data.py`, spec).
  - Internal keys in `app.html`: panels `filtros/ajustes/sinalizados/conta` → `filters/settings/flagged/account`; note tabs `nota/resumo/questoes` → `note/summary/questions`. Saved panel open/closed state (`kairos.panels`) resets once; no migration, it is cosmetic.
  - README, spec (flag labels and copy format too), comments, test fixtures; card sources `(nota N)` → `(note N)`.
  - Kept: `TAG_RENAME` (migrates old saved filters).
- Content review of the decks never reviewed before (Delta One, LLM 02–05, System Design), by five parallel reviewer agents; the lead checked every finding (numbers rerun, sources opened, LangGraph claims run on 1.2.24) before applying. Result: 44 cards rewritten, 55 new cards, 1 suspended (`d1-01-physical-002`, a list card covered by others), 7 notes edited.
  - Errors fixed, among others: dealer-route capital in note d1-02 (client 10 + dealer 2 = 12; dealer quote now SOFR + 29, so the 45.7 all-in and every downstream number stay); switch to physical needs a conversion, not a reversal; bcrypt is not memory-hard; Observer is not pub-sub; outbox gives at-least-once; saga replaces 2PC, not a lock; LangGraph default recursion limit is 10,007 since 1.1.4 and a missing `thread_id` raises `ValueError`; KV-cache and H100 decode examples that did not fit in 80 GB; note d1-04 q10 and q05 explanations.
  - Structural: note d1-04 gets objective o6 + question q12 (leveraged ETF close order); note llm-03 gets objective o6 (retries/idempotency); llm-04 q05 re-keyed (answer 4, checked by running the graph).
  - `d1-03-divs-index-004/-005` moved to deck `d1-04-index-events` (same ids; they point to the d1-04 note).
  - Not done: Cesari decks (already reviewed in `933d3bf`), per-card `source` cleanup on sd-04/sd-07 (boilerplate sources), cross-domain tags on sd-04-027 / sd-05-007 / sd-06-007.
- Added `.github/workflows/keepalive.yml`: reads one `ingest_state` row every 3 days with the service role key, so the Free-plan Supabase project never pauses (pause rule: 7 days without database activity). The anon key cannot see any table, so it cannot do this. Caveat: GitHub disables scheduled workflows after 60 days without repo activity.
- Added `CLAUDE.md` and this worklog. `.venv/` is git-ignored.
