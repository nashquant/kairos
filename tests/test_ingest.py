"""End-to-end test of private ingest against a mock Supabase REST API.
bootstrap -> encrypt_private -> apply (upsert) -> second chunk (delete) -> idempotent re-run.
Run: python3 tests/test_ingest.py"""
import json, os, pathlib, shutil, subprocess, sys, tempfile, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB = {"ingest_state": {}, "private_docs": {}, "users": [{"id": "u-me", "email": "Me@X.com"}, {"id": "u-other", "email": "o@x.com"}]}
KEY = "sb_secret_test"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _auth(self):
        if self.headers.get("apikey") != KEY or (KEY.startswith("eyJ") and self.headers.get("Authorization") != "Bearer " + KEY):
            self.send_response(401); self.end_headers(); return False
        return True

    def _send(self, obj, code=200):
        raw = b"" if obj is None else json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        if not self._auth(): return
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == "/rest/v1/ingest_state":
            k = q["key"][0].removeprefix("eq.")
            return self._send([{"value": DB["ingest_state"][k]}] if k in DB["ingest_state"] else [])
        if u.path == "/auth/v1/admin/users":
            return self._send({"users": DB["users"]})
        self._send({"error": "no route"}, 404)

    def do_POST(self):
        if not self._auth(): return
        u = urllib.parse.urlparse(self.path)
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert self.headers.get("Prefer") == "resolution=merge-duplicates"
        if u.path == "/rest/v1/ingest_state":
            for r in body: DB["ingest_state"][r["key"]] = r["value"]
            return self._send(None, 201)
        if u.path == "/rest/v1/private_docs":
            for r in body: DB["private_docs"][(r["owner"], r["coll"], r["id"])] = r["body"]
            return self._send(None, 201)
        self._send({"error": "no route"}, 404)

    def do_DELETE(self):
        if not self._auth(): return
        u = urllib.parse.urlparse(self.path); q = {k: v[0].removeprefix("eq.") for k, v in urllib.parse.parse_qs(u.query).items()}
        DB["private_docs"].pop((q["owner"], q["coll"], q["id"]), None)
        self._send(None, 204)


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    tmp = pathlib.Path(tempfile.mkdtemp())
    for p in ("scripts", "data"):
        shutil.copytree(ROOT / p, tmp / p)
    shutil.rmtree(tmp / "data" / "private", ignore_errors=True)
    (tmp / "data" / "ingest-public-key.json").unlink(missing_ok=True)
    env = dict(os.environ, SUPABASE_URL=f"http://127.0.0.1:{srv.server_port}", SUPABASE_SERVICE_ROLE_KEY=KEY, KAIROS_OWNER_EMAIL="me@x.com")
    run = lambda *a: subprocess.run([sys.executable, *a], cwd=tmp, env=env, check=True, capture_output=True, text=True).stdout
    fails = 0
    def ok(c, m):
        nonlocal fails
        print(("  ok   " if c else "  FAIL ") + m); fails += (not c)

    run("scripts/ingest_private.py", "bootstrap")
    pub = json.loads((tmp / "data" / "ingest-public-key.json").read_text())
    ok("pem" in DB["ingest_state"]["keypair"] and "pem" not in pub and "d" not in pub, "bootstrap stores private key in Supabase, public key in repo")
    run("scripts/ingest_private.py", "bootstrap")
    ok(json.loads((tmp / "data" / "ingest-public-key.json").read_text())["kid"] == pub["kid"], "bootstrap is idempotent (same key)")

    plain = tmp / "plain.json"
    plain.write_text(json.dumps({"decks": {"p1": {"name": "Pessoal::Teste", "created": 1}}, "cards": {"p1-001": {"deck": "p1", "front": "Pergunta secreta", "back": "x", "tags": [], "created": 1}, "p1-002": {"deck": "p1", "front": "Q2", "back": "y", "tags": [], "created": 2}}}))
    run("scripts/encrypt_private.py", str(plain), "chunk-001")
    ok("secreta" not in (tmp / "data" / "private" / "chunk-001.enc.json").read_text(), "chunk is ciphertext only")
    out = run("scripts/ingest_private.py", "apply")
    ok(("u-me", "cards", "p1-001") in DB["private_docs"] and ("u-me", "decks", "p1") in DB["private_docs"], "apply writes deck and cards for the owner (email match ignores case)")
    ok(not any(k[0] == "u-other" for k in DB["private_docs"]), "nothing written for other users")

    plain.write_text(json.dumps({"cards": {"p1-002": None, "p1-001": {"deck": "p1", "front": "Editada", "back": "x", "tags": [], "created": 1}}}))
    run("scripts/encrypt_private.py", str(plain), "chunk-002")
    out = run("scripts/ingest_private.py", "apply")
    ok(("u-me", "cards", "p1-002") not in DB["private_docs"] and DB["private_docs"][("u-me", "cards", "p1-001")]["front"] == "Editada", "second chunk deletes and edits")
    out = run("scripts/ingest_private.py", "apply")
    ok("nothing to apply" in out, "re-run applies nothing (applied list kept)")
    srv.shutdown(); shutil.rmtree(tmp)
    print(f"\n{'all passed' if not fails else str(fails) + ' failed'}"); sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
