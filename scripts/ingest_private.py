#!/usr/bin/env python3
"""Private decks: key setup and ingest into Supabase. Runs in GitHub Actions.

  python3 scripts/ingest_private.py bootstrap
      Makes the ingest key pair once. The private key is stored in Supabase
      (table ingest_state, reachable only with the service role). The public key
      is written to data/ingest-public-key.json for encrypt_private.py.
  python3 scripts/ingest_private.py apply
      Decrypts every data/private/*.enc.json not applied yet and writes its decks
      and cards to private_docs for the owner (KAIROS_OWNER_EMAIL). null deletes.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KAIROS_OWNER_EMAIL.
"""
import base64, hashlib, json, os, pathlib, sys, urllib.parse, urllib.request
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = pathlib.Path(__file__).resolve().parent.parent
PRIV_DIR = ROOT / "data" / "private"
PUB_FILE = ROOT / "data" / "ingest-public-key.json"


class Supabase:
    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key

    def call(self, method, path, body=None, prefer=None):
        req = urllib.request.Request(self.url + path, method=method, data=None if body is None else json.dumps(body).encode())
        req.add_header("apikey", self.key)
        if self.key.startswith("eyJ"):  # legacy JWT service_role key; new sb_secret_ keys go on apikey only
            req.add_header("Authorization", "Bearer " + self.key)
        req.add_header("Content-Type", "application/json")
        if prefer:
            req.add_header("Prefer", prefer)
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    def get_state(self, key):
        rows = self.call("GET", "/rest/v1/ingest_state?select=value&key=eq." + urllib.parse.quote(key))
        return rows[0]["value"] if rows else None

    def set_state(self, key, value):
        self.call("POST", "/rest/v1/ingest_state", [{"key": key, "value": value}], "resolution=merge-duplicates")

    def user_id(self, email):
        page = 1
        while True:
            res = self.call("GET", f"/auth/v1/admin/users?page={page}&per_page=1000")
            users = res.get("users", res) if isinstance(res, dict) else res
            for u in users:
                if (u.get("email") or "").lower() == email.lower():
                    return u["id"]
            if len(users) < 1000:
                return None
            page += 1


def b64u_int(s):
    return int.from_bytes(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)), "big")


def int_b64u(i):
    return base64.urlsafe_b64encode(i.to_bytes((i.bit_length() + 7) // 8, "big")).rstrip(b"=").decode()


def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"missing env {name}")
    return v


def bootstrap(sb):
    state = sb.get_state("keypair")
    if not state:
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        pub = key.public_key().public_numbers()
        n, e = int_b64u(pub.n), int_b64u(pub.e)
        kid = hashlib.sha256(n.encode()).hexdigest()[:16]
        state = {"kid": kid, "pem": pem, "n": n, "e": e}
        sb.set_state("keypair", state)
        print("created ingest key", kid)
    pub = {"kid": state["kid"], "alg": "RSA-OAEP-256+A256GCM", "n": state["n"], "e": state["e"]}
    PUB_FILE.write_text(json.dumps(pub, indent=1) + "\n")
    print("public key written:", state["kid"])


def apply(sb, owner_email):
    state = sb.get_state("keypair")
    if not state:
        sys.exit("no ingest key; run bootstrap first")
    key = serialization.load_pem_private_key(state["pem"].encode(), password=None)
    applied = set(sb.get_state("applied") or [])
    files = json.loads((PRIV_DIR / "index.json").read_text())["files"] if (PRIV_DIR / "index.json").exists() else []
    todo = [f for f in files if f not in applied]
    if not todo:
        print("nothing to apply")
        return
    owner = sb.user_id(owner_email)
    if not owner:
        sys.exit(f"no Supabase user with email {owner_email}; sign in on the site once first")
    for fname in todo:
        chunk = json.loads((PRIV_DIR / fname).read_text())
        if chunk["kid"] != state["kid"]:
            sys.exit(f"{fname}: encrypted for key {chunk['kid']}, current key is {state['kid']}")
        aes = key.decrypt(base64.b64decode(chunk["ek"]), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        plain = json.loads(AESGCM(aes).decrypt(base64.b64decode(chunk["iv"]), base64.b64decode(chunk["ct"]), None))
        rows, deletes = [], []
        for coll in ("decks", "cards"):
            for doc_id, body in (plain.get(coll) or {}).items():
                (deletes if body is None else rows).append((coll, doc_id, body))
        if rows:
            sb.call("POST", "/rest/v1/private_docs?on_conflict=owner,coll,id",
                    [{"owner": owner, "coll": c, "id": i, "body": b} for c, i, b in rows], "resolution=merge-duplicates")
        for c, i, _ in deletes:
            q = "owner=eq.{}&coll=eq.{}&id=eq.{}".format(owner, c, urllib.parse.quote(i, safe=""))
            sb.call("DELETE", "/rest/v1/private_docs?" + q)
        applied.add(fname)
        sb.set_state("applied", sorted(applied))
        print(f"applied {fname}: {len(rows)} upserts, {len(deletes)} deletes")


if __name__ == "__main__":
    sb = Supabase(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"))
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "bootstrap":
        bootstrap(sb)
    elif mode == "apply":
        apply(sb, env("KAIROS_OWNER_EMAIL"))
    else:
        sys.exit(__doc__)
