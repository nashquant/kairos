#!/usr/bin/env python3
"""Encrypt a chunk of private decks/cards for ingest (used by Claude).

Usage: python3 scripts/encrypt_private.py <plain.json> <chunk-name>

<plain.json> is {"decks": {id: deck|null}, "cards": {id: card|null}}; null deletes.
Encrypts with a random AES-256-GCM key wrapped by the ingest public key
(data/ingest-public-key.json, RSA-OAEP SHA-256). Writes data/private/<name>.enc.json
and lists it in data/private/index.json. After the push, the "Ingest private decks"
workflow writes the content to Supabase for the owner. Never commit <plain.json>.
"""
import base64, json, os, pathlib, sys
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = pathlib.Path(__file__).resolve().parent.parent
PRIV = ROOT / "data" / "private"


def b64u_int(s):
    return int.from_bytes(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)), "big")


def main(src, name):
    pk = json.loads((ROOT / "data" / "ingest-public-key.json").read_text())
    pub = rsa.RSAPublicNumbers(b64u_int(pk["e"]), b64u_int(pk["n"])).public_key()
    plain = json.loads(pathlib.Path(src).read_text(encoding="utf-8"))
    assert set(plain) <= {"decks", "cards"}, "plain JSON must have only decks/cards"
    key, iv = AESGCM.generate_key(bit_length=256), os.urandom(12)
    ct = AESGCM(key).encrypt(iv, json.dumps(plain, ensure_ascii=False).encode(), None)
    ek = pub.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    b = lambda x: base64.b64encode(x).decode()
    PRIV.mkdir(parents=True, exist_ok=True)
    fname = f"{name}.enc.json"
    (PRIV / fname).write_text(json.dumps({"v": 1, "kid": pk["kid"], "ek": b(ek), "iv": b(iv), "ct": b(ct)}))
    idx_path = PRIV / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {"files": []}
    if fname not in idx["files"]:
        idx["files"].append(fname)
    idx_path.write_text(json.dumps(idx, indent=1) + "\n")
    print(f"wrote data/private/{fname}: {len(plain.get('decks', {}))} decks, {len(plain.get('cards', {}))} cards")


if __name__ == "__main__":
    main(*sys.argv[1:3])
