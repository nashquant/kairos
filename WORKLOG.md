# Worklog

Newest first. One entry per working day: what changed, the decisions behind it, and the commits.
Changes that git does not see (Supabase data, private decks) go here too.

## 2026-11-20

- Finished the English pass started in `a7b3376`:
  - Objective verbs in `data/notes.json`: `definir/explicar/calcular/comparar/diagnosticar` → `define/explain/calculate/compare/diagnose` (`OBJ_VERBS`, `tests/test_data.py`, spec).
  - Internal keys in `app.html`: panels `filtros/ajustes/sinalizados/conta` → `filters/settings/flagged/account`; note tabs `nota/resumo/questoes` → `note/summary/questions`. Saved panel open/closed state (`kairos.panels`) resets once; no migration, it is cosmetic.
  - README, spec (flag labels and copy format too), comments, test fixtures; card sources `(nota N)` → `(note N)`.
  - Kept: `TAG_RENAME` (migrates old saved filters).
- Added `.github/workflows/keepalive.yml`: reads one `ingest_state` row every 3 days with the service role key, so the Free-plan Supabase project never pauses (pause rule: 7 days without database activity). The anon key cannot see any table, so it cannot do this. Caveat: GitHub disables scheduled workflows after 60 days without repo activity.
- Added `CLAUDE.md` and this worklog. `.venv/` is git-ignored.
