#!/usr/bin/env python3
"""Build the GitHub Pages site (web/) from app.html.

app.html is the single source of the app. It runs as a claude.ai artifact
there; here it gets a standalone page skeleton, a local data adapter
(web-src/adapter.js), a service worker for offline use, and a manifest.
Card data comes from data/decks.json and data/cards.json.
"""
import hashlib, json, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "web-src", ROOT / "web"

app = (ROOT / "app.html").read_text(encoding="utf-8")
adapter = (SRC / "adapter.js").read_text(encoding="utf-8")
decks = json.loads((ROOT / "data" / "decks.json").read_text(encoding="utf-8"))
cards = json.loads((ROOT / "data" / "cards.json").read_text(encoding="utf-8"))

version = hashlib.sha256((app + adapter + json.dumps(decks) + json.dumps(cards)).encode()).hexdigest()[:12]

head = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Flashcards com repetição espaçada FSRS. Cada card volta no momento certo.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Kairos">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#E9EDEC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D1412" media="(prefers-color-scheme: dark)">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
"""

# The adapter must define window.claude before the app script runs.
marker = "<script>\n/* ---------- utils ---------- */"
assert app.count(marker) == 1, "app.html main script marker not found"
app = app.replace(marker, "<script>\n" + adapter + "\n</script>\n" + marker, 1)
app = app.replace("Abra esta página no claude.ai para acessar seus cards.", "Não foi possível carregar os cards. Abra o site com internet uma vez.")

tail = """
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(e){ console.warn('SW', e); }); });
}
</script>
</body>
</html>
"""

if OUT.exists():
    shutil.rmtree(OUT)
(OUT / "data").mkdir(parents=True)
(OUT / "index.html").write_text(head + app + tail, encoding="utf-8")
(OUT / "sw.js").write_text((SRC / "sw.js").read_text(encoding="utf-8").replace("__BUILD__", version), encoding="utf-8")
for f in (SRC / "icons").glob("*.png"):
    shutil.copy(f, OUT / f.name)
(OUT / "data" / "decks.json").write_text(json.dumps(decks, ensure_ascii=False), encoding="utf-8")
(OUT / "data" / "cards.json").write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
manifest = {
    "name": "Kairos", "short_name": "Kairos",
    "description": "Flashcards com repetição espaçada FSRS.",
    "lang": "pt-BR", "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#0D1412", "theme_color": "#1C6B62",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
(OUT / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
(OUT / ".nojekyll").write_text("")
print(f"web/ built: version {version}, {len(decks)} decks, {len(cards)} cards")
