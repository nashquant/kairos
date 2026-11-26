# Worklog

Newest first. One entry per working day: what changed, the decisions behind it, and the commits.
Changes that git does not see (Supabase data, private decks) go here too.

## 2026-11-26

- Removed `.github/workflows/keepalive.yml`. It never worked: the `SUPABASE_SERVICE_ROLE_KEY` secret was never set, so every run failed (Nov 22, Nov 25). Supabase sync was never activated (schema not applied, `db.yml` never ran), and the user will delete the Supabase project. The app keeps progress on the device and does not need Supabase.
- Then turned Supabase off in the app, with the user's approval: `supabaseAnonKey` is empty in `data/config.json`, so the account panel is hidden. Removed `db.yml` (never ran) and `ingest.yml` (failed Nov 5). Private decks are disabled: every new deck is public, and material that cannot be public stays out (spec updated). Kept the code (`web-src/adapter.js`, `supabase/`, `scripts/encrypt_private.py`, `tests/test_ingest.py`) for a possible reactivation; spec says how.
- The repo stays as the base for future study work: decks, cards and notes.

## 2026-11-24

- LLM notes complete: `llm-02-training` (9 sections, 12 questions, 6 objectives; example: **Tutor**, a math assistant pretrained at 70B, then SFT → preferences → RLVR → LoRA/QLoRA → distilled to 8B) and `llm-05-inference` (9 sections, 12 questions, 6 objectives; example: a Llama-3-70B-style model served to 32 users at 8k context on H100s). All 17 llm-02 and 19 llm-05 cards link to a section.
- Checks:
  - Every number recomputed in Python (6ND, Chinchilla-fit losses, GPU-days, Bradley–Terry, DPO loss, GRPO advantages, quantization round-trip, KV sizes, decode ceilings, roofline, paged vs reserved KV, speculative-decoding expectation, also by simulation).
  - Library claims run in a scratch venv: peft 0.17.1 (LoRA r=8 on 4096×4096 → 65,536 trainable; B starts at zero; defaults r=8, alpha=8; merge matches), transformers 4.57.6 (Llama 3 70B/8B parameter counts from the public `config.json`: 70.55B / 8.03B).
  - Primary sources read: Chinchilla eq. 10 and Tables 2–3 (PDF), DPO eqs. 1/3/7, DeepSeekMath (GRPO), QLoRA (blocksize 64, 0.127 bits/param), Kalai et al. 2025 (confidence targets), vLLM paper (block 16, 20–38% KV use), Leviathan eq. 1, Mixtral post, NVIDIA H100 page, Meta Llama 3 post.
  - All 184 formulas in the two notes and their cards compile with MathJax 3.2.2 (`mathjax-full`, all packages except autoload/require/noundefined, so an unknown macro is an error). The earlier checker was not kept; this one lived in the session scratchpad.
- Card fixes: `llm-05-inference-002` (the cache does not make each step "work for one token": attention still reads every cached token). Specific `source` replaces the boilerplate on llm-02-001…014 and llm-05-012/013/014 (the RLHF/DPO cards cited Chinchilla and LoRA).

## 2026-11-23

- System Design notes complete: 8 new notes, one per deck, except sd-04, which is split in two (`sd-04-web-security` for web attacks, `sd-04-web-security-2` for identity/OAuth/SSO; 33 cards were too many for one note at pilot depth). Each has 8–9 sections and 12 questions, with one worked example per note: digital wallet (sd-02), shop checkout (sd-03), expense app (sd-04, sd-07), bookstore on Next.js (sd-05), fictional broker and venue (sd-06), shipping service (sd-08). All 161 non-suspended sd cards now link to a note section.
  - Drafted by 4 parallel agents; the lead read every note, re-ran the numbers (incl. the RFC 7636 PKCE example, the JWT payload, the toy ECDSA nonce-reuse recovery) and compiled all 256 formulas with MathJax 3.
  - NIST IR 8547 dates (2030/2035) are cited as the 2024 draft's; the final text was not read.
- Card fixes from the note work (13): sd-06-003 (15c3-5 says credit or capital thresholds, not position limits); sd-03-016 (budget in requests too); sd-04-002/005; sd-05-010; sd-08-014/021/022.
  - Desk wording out of public decks: sd-06-007 drops "Delta One" and its `delta-one` tag; sd-08-007 (hedge routes → shipping rate rules), sd-08-009 (no more DPR), sd-04-025/026 (`expenses:read`, cost centre).
- Specific `source` on sd-04-001…027, sd-04-033 (OWASP Top 10:2025) and sd-07-001…016, replacing the boilerplate; plus sd-03-018, sd-06-002/003.

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
