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
      names.forEach(function(n, i){ base[n] = res[i] || {}; });
      baseLoaded = true; emitSoon();
    }).catch(function(err){
      console.warn('Kairos: could not load card data', err);
      baseLoaded = true; emitSoon();
    });
  }

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
  window.KAIROS_WEB = { reload: loadBase, exportProgress: function(){ return clone(local); } };
  window.claude = { use: function(name){ return Promise.resolve(name === 'db' ? db : null); } };
})();
