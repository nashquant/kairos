"""Validate public card data: schema, tag labels, ids, dates.
With --base <git-ref>, also fail if a public card id was removed (ids are permanent).
Run: python3 tests/test_data.py [--base origin/main]"""
import json, re, subprocess, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
decks = json.loads((ROOT / "data/decks.json").read_text(encoding="utf-8"))
cards = json.loads((ROOT / "data/cards.json").read_text(encoding="utf-8"))
labels = set(re.findall(r"'?([a-z0-9-]+)'?:'", (ROOT / "app.html").read_text(encoding="utf-8").split("const TAG_LABELS=")[1].split("};")[0]))
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
errs = []
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
if "--base" in sys.argv:
    ref = sys.argv[sys.argv.index("--base") + 1]
    old = json.loads(subprocess.run(["git", "show", f"{ref}:data/cards.json"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    for cid in old.keys() - cards.keys(): errs.append(f"{cid}: removed (suspend instead)")
for e in errs: print("FAIL", e)
print(f"{len(cards)} cards, {len(decks)} decks: " + ("ok" if not errs else f"{len(errs)} errors"))
sys.exit(1 if errs else 0)
