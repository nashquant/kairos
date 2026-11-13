"""Validate public card data: schema, tag labels, ids, dates; study notes and card -> note links.
With --base <git-ref>, also fail if a public card id was removed (ids are permanent).
Run: python3 tests/test_data.py [--base origin/main]"""
import json, re, subprocess, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
decks = json.loads((ROOT / "data/decks.json").read_text(encoding="utf-8"))
cards = json.loads((ROOT / "data/cards.json").read_text(encoding="utf-8"))
notes_path = ROOT / "data/notes.json"
notes = json.loads(notes_path.read_text(encoding="utf-8")) if notes_path.exists() else {}
labels = set(re.findall(r"'?([a-z0-9-]+)'?:'", (ROOT / "app.html").read_text(encoding="utf-8").split("const TAG_LABELS=")[1].split("};")[0]))
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
errs = []
VERBS = {"definir", "explicar", "calcular", "comparar", "diagnosticar"}
qids = set()
for cid, c in cards.items():
    for k in ("deck", "front", "back", "tags", "source", "created", "suspended"):
        if k not in c: errs.append(f"{cid}: missing {k}")
    if c.get("deck") not in decks: errs.append(f"{cid}: unknown deck {c.get('deck')}")
    if not re.match(r"^[a-z0-9-]+-\d{3}$", cid): errs.append(f"{cid}: bad id format")
    tags = c.get("tags", [])
    if not 1 <= len([t for t in tags if t != "datado"]) <= 3: errs.append(f"{cid}: {len(tags)} tags")
    for t in tags:
        if t not in labels: errs.append(f"{cid}: tag {t} has no label in TAG_LABELS")
    for k in ("verified", "checkBy"):
        if k in c and not DATE.match(c[k]): errs.append(f"{cid}: bad {k} {c[k]}")
    if "checkBy" in c and "verified" not in c: errs.append(f"{cid}: checkBy without verified")
for nid, n in notes.items():
    if not re.match(r"^[a-z0-9-]+$", nid): errs.append(f"note {nid}: bad id format")
    for k in ("deck", "title", "sections", "created", "verified"):
        if k not in n: errs.append(f"note {nid}: missing {k}")
    if n.get("deck") not in decks: errs.append(f"note {nid}: unknown deck {n.get('deck')}")
    if "verified" in n and not DATE.match(n["verified"]): errs.append(f"note {nid}: bad verified")
    ids = [s.get("id") for s in n.get("sections", [])]
    if len(ids) != len(set(ids)): errs.append(f"note {nid}: duplicate section ids")
    for s in n.get("sections", []):
        if not re.match(r"^[a-z0-9-]+$", s.get("id") or ""): errs.append(f"note {nid}: bad section id {s.get('id')}")
        if not s.get("title") or not s.get("body"): errs.append(f"note {nid}#{s.get('id')}: empty title or body")
    objs = [o.get("id") for o in n.get("objectives", [])]
    if len(objs) != len(set(objs)): errs.append(f"note {nid}: duplicate objective ids")
    for o in n.get("objectives", []):
        if o.get("verb") not in VERBS: errs.append(f"note {nid}: objective {o.get('id')} verb {o.get('verb')} not in {sorted(VERBS)}")
        if not o.get("text"): errs.append(f"note {nid}: objective {o.get('id')} without text")
    for s in n.get("sections", []):
        for o in s.get("obj", []):
            if o not in objs: errs.append(f"note {nid}#{s.get('id')}: unknown objective {o}")
    for q in n.get("questions", []):
        qid = q.get("id", "")
        if not re.match(rf"^{re.escape(nid)}-q\d{{2}}$", qid): errs.append(f"note {nid}: bad question id {qid}")
        if qid in qids: errs.append(f"{qid}: duplicate question id")
        qids.add(qid)
        if q.get("obj") not in objs: errs.append(f"{qid}: unknown objective {q.get('obj')}")
        if q.get("sec") and q["sec"] not in ids: errs.append(f"{qid}: unknown section {q['sec']}")
        if not q.get("stem"): errs.append(f"{qid}: empty stem")
        if q.get("type") == "mc":
            ops = q.get("options", [])
            if not 3 <= len(ops) <= 5: errs.append(f"{qid}: {len(ops)} options (3-5)")
            if sum(1 for o in ops if o.get("ok")) != 1: errs.append(f"{qid}: needs exactly one correct option")
            for o in ops:
                if not o.get("t") or not o.get("why"): errs.append(f"{qid}: option without text or explanation")
        elif q.get("type") == "open":
            if not q.get("answer"): errs.append(f"{qid}: open question without model answer")
        else: errs.append(f"{qid}: type must be mc or open")
for cid, c in cards.items():
    if "note" not in c: continue
    nid, _, sec = c["note"].partition("#")
    if nid not in notes: errs.append(f"{cid}: note {nid} does not exist")
    elif sec and sec not in [s.get("id") for s in notes[nid].get("sections", [])]: errs.append(f"{cid}: note section {c['note']} does not exist")
if "--base" in sys.argv:
    ref = sys.argv[sys.argv.index("--base") + 1]
    old = json.loads(subprocess.run(["git", "show", f"{ref}:data/cards.json"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    for cid in old.keys() - cards.keys(): errs.append(f"{cid}: removed (suspend instead)")
for e in errs: print("FAIL", e)
print(f"{len(cards)} cards, {len(decks)} decks, {len(notes)} notes: " + ("ok" if not errs else f"{len(errs)} errors"))
sys.exit(1 if errs else 0)
