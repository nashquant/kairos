/* Kairos web adapter.
   The app (app.html) talks to a document store through window.claude.use('db').
   On GitHub Pages there is no claude.ai store, so this file provides a local one
   with the same small API the app uses:
     db.collection(path).onSnapshot(next, error)
     db.doc(path).set(body) / .delete() / .onSnapshot(next, error)
   Base data (decks, cards) comes from data/*.json in the repo, served by the site.
   Everything the viewer writes (progress, log, settings, own card edits) lives in
   localStorage on this device. A local write is a tombstone or a full document. */
(function(){
  'use strict';
  var STORE_KEY = 'kairos.local.v1';
  var DATA_FILES = { decks: 'data/decks.json', cards: 'data/cards.json' };

  function readStore(){ try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function writeStore(s){ try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }

  var local = readStore();            // { "reviews/c1": {...} | {"__deleted": true}, ... }
  var base = { decks: {}, cards: {} };// from the repo
  var baseLoaded = false;
  var listeners = [];                 // { kind: 'coll'|'doc', path, next }

  function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function collOf(path){ return path.split('/')[0]; }
  function idOf(path){ return path.split('/').slice(1).join('/'); }

  function collectionDocs(coll){
    var out = {}, k;
    var b = base[coll] || {};
    for (k in b) out[k] = b[k];
    for (k in local){
      if (collOf(k) !== coll) continue;
      var id = idOf(k);
      if (local[k] && local[k].__deleted) delete out[id]; else out[id] = local[k];
    }
    return out;
  }
  function docSnap(path){
    var coll = collOf(path), id = idOf(path), v;
    if (path in local) v = local[path] && local[path].__deleted ? undefined : local[path];
    else v = (base[coll] || {})[id];
    return { id: id, exists: v !== undefined, data: function(){ return clone(v); }, metadata: { fromCache: !baseLoaded, hasPendingWrites: false } };
  }
  function collSnap(coll){
    var docs = collectionDocs(coll), arr = Object.keys(docs).sort().map(function(id){
      var v = docs[id];
      return { id: id, exists: true, data: function(){ return clone(v); }, metadata: { fromCache: false, hasPendingWrites: false } };
    });
    return { docs: arr, size: arr.length, empty: !arr.length, metadata: { fromCache: !baseLoaded, hasPendingWrites: false }, docChanges: function(){ return []; } };
  }
  function emit(){
    listeners.forEach(function(l){
      if (l.dead) return;
      try { l.next(l.kind === 'coll' ? collSnap(l.path) : docSnap(l.path)); } catch (e) { console.error(e); }
    });
  }
  var emitQueued = false;
  function emitSoon(){ if (emitQueued) return; emitQueued = true; setTimeout(function(){ emitQueued = false; emit(); }, 0); }

  function write(path, body){
    local[path] = body;
    if (!writeStore(local)) return Promise.reject({ code: 'quota_exceeded', message: 'Device storage is full.' });
    emitSoon();
    return Promise.resolve();
  }

  // Other tabs of the same app on this device stay in step.
  window.addEventListener('storage', function(e){ if (e.key === STORE_KEY){ local = readStore(); emitSoon(); } });

  function loadBase(){
    var names = Object.keys(DATA_FILES);
    return Promise.all(names.map(function(n){
      return fetch(DATA_FILES[n], { cache: 'no-cache' }).then(function(r){ if (!r.ok) throw new Error(n + ' ' + r.status); return r.json(); });
    })).then(function(res){
      var fresh = {};
      names.forEach(function(n, i){ fresh[n] = res[i] || {}; });
      return loadPrivate(fresh).catch(function(err){ console.warn('Kairos: private decks', err); }).then(function(){ base = fresh; });
    }).catch(function(err){
      console.warn('Kairos: could not load card data', err);
    }).then(function(){ baseLoaded = true; emitSoon(); });
  }

  /* ---------- private decks ----------
     data/private/index.json lists encrypted chunks. Each chunk:
       {v:1, kid, ek: RSA-OAEP-SHA256(aesKey), iv, ct: AES-256-GCM(json)}  (base64)
     The JSON is {decks:{id:deck|null}, cards:{id:card|null}}; null deletes; later chunks win.
     The device keeps its RSA private key in localStorage (kairos.key.v1). */
  var KEY_STORE = 'kairos.key.v1';
  var subtle = (window.crypto && window.crypto.subtle) || null;
  var enc = { encode: function(t){ return new TextEncoder().encode(t); } }, dec = { decode: function(b){ return new TextDecoder().decode(b); } };
  function b64d(s){ var bin = atob(s.replace(/-/g,'+').replace(/_/g,'/')); var u = new Uint8Array(bin.length); for (var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
  function b64e(u){ var s=''; u=new Uint8Array(u); for (var i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); }
  function readKey(){ try { return JSON.parse(localStorage.getItem(KEY_STORE)); } catch (e) { return null; } }
  var status = { files: 0, opened: 0, wrongKey: 0 };

  async function loadPrivate(target){
    status = { files: 0, opened: 0, wrongKey: 0 };
    var idx;
    try { var r = await fetch('data/private/index.json', { cache: 'no-cache' }); if (!r.ok) return; idx = await r.json(); } catch (e) { return; }
    var files = (idx && idx.files) || [];
    status.files = files.length;
    var k = readKey();
    if (!files.length || !k || !subtle) return;
    var priv = await subtle.importKey('jwk', k.priv, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    for (var i = 0; i < files.length; i++){
      var chunk;
      try { chunk = await (await fetch('data/private/' + files[i], { cache: 'no-cache' })).json(); } catch (e) { continue; }
      if (chunk.kid !== k.kid){ status.wrongKey++; continue; }
      var raw = await subtle.decrypt({ name: 'RSA-OAEP' }, priv, b64d(chunk.ek));
      var aes = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
      var pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64d(chunk.iv) }, aes, b64d(chunk.ct));
      var obj = JSON.parse(dec.decode(pt));
      ['decks', 'cards'].forEach(function(coll){
        var m = obj[coll] || {};
        Object.keys(m).forEach(function(id){
          if (m[id] === null) delete target[coll][id];
          else { var v = m[id]; if (coll === 'decks') v.private = true; target[coll][id] = v; }
        });
      });
      status.opened++;
    }
  }

  async function sha16(text){ var h = await subtle.digest('SHA-256', enc.encode(text)); return Array.from(new Uint8Array(h)).slice(0, 8).map(function(x){ return x.toString(16).padStart(2, '0'); }).join(''); }
  async function passKey(pass, salt){
    var base = await subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  var keys = {
    has: function(){ return !!readKey(); },
    kid: function(){ var k = readKey(); return k ? k.kid : ''; },
    publicText: function(){ var k = readKey(); return k ? JSON.stringify({ kid: k.kid, alg: 'RSA-OAEP-256', n: k.pub.n, e: k.pub.e }) : ''; },
    generate: async function(){
      if (!subtle) throw new Error('Este navegador não tem criptografia (WebCrypto).');
      var kp = await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
      var pub = await subtle.exportKey('jwk', kp.publicKey), priv = await subtle.exportKey('jwk', kp.privateKey);
      var kid = await sha16(pub.n);
      localStorage.setItem(KEY_STORE, JSON.stringify({ kid: kid, pub: { kty: 'RSA', n: pub.n, e: pub.e }, priv: priv }));
      return kid;
    },
    exportBackup: async function(pass){
      var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      var ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, await passKey(pass, salt), enc.encode(localStorage.getItem(KEY_STORE)));
      var all = new Uint8Array(28 + ct.byteLength); all.set(salt, 0); all.set(iv, 16); all.set(new Uint8Array(ct), 28);
      return 'KAIROS1.' + b64e(all);
    },
    importBackup: async function(code, pass){
      if (!/^KAIROS1\./.test(code)) throw new Error('bad-pass');
      var all = b64d(code.slice(8));
      var pt;
      try { pt = await subtle.decrypt({ name: 'AES-GCM', iv: all.slice(16, 28) }, await passKey(pass, all.slice(0, 16)), all.slice(28)); }
      catch (e) { throw new Error('bad-pass'); }
      var k = JSON.parse(dec.decode(pt)); if (!k.kid || !k.priv) throw new Error('bad-pass');
      localStorage.setItem(KEY_STORE, JSON.stringify(k));
    },
    forget: function(){ localStorage.removeItem(KEY_STORE); }
  };

  var db = {
    collection: function(path){
      return { path: path, onSnapshot: function(next){ var l = { kind: 'coll', path: path, next: next }; listeners.push(l); emitSoon(); return function(){ l.dead = true; }; } };
    },
    doc: function(path){
      return {
        path: path, id: idOf(path),
        get: function(){ return Promise.resolve(docSnap(path)); },
        set: function(body){ return write(path, clone(body)); },
        update: function(body){ var cur = docSnap(path); if (!cur.exists) return Promise.reject({ code: 'invalid_argument', message: 'missing' }); return write(path, Object.assign(cur.data(), clone(body))); },
        delete: function(){ return write(path, { __deleted: true }); },
        onSnapshot: function(next){ var l = { kind: 'doc', path: path, next: next }; listeners.push(l); emitSoon(); return function(){ l.dead = true; }; }
      };
    }
  };

  loadBase();
  window.KAIROS_WEB = { reload: loadBase, keys: keys, exportProgress: function(){ return clone(local); } };
  Object.defineProperty(window.KAIROS_WEB, 'privateStatus', { get: function(){ return status; } });
  window.claude = { use: function(name){ return Promise.resolve(name === 'db' ? db : null); } };
})();
