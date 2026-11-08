/* Kairos web adapter.
   The app (app.html) talks to a document store through window.claude.use('db'):
     db.collection(path).onSnapshot(next, error)
     db.doc(path).set(body) / .delete() / .onSnapshot(next, error)
   This file provides that store for the website:
   - Public decks and cards come from data/*.json in the repo.
   - Every write (progress, daily log, settings, own card edits) lands in localStorage
     first, so the app works offline.
   - When the user is signed in (Supabase Auth, email code), writes sync to the
     user's rows in Supabase and changes from other devices are pulled in.
     Newest write per document wins; daily logs are merged entry by entry.
   - Private decks and cards are read from Supabase for the signed-in owner. */
(function(){
  'use strict';
  var STORE_KEY = 'kairos.local.v1', SYNC_KEY = 'kairos.sync.v1';
  var DATA_FILES = { decks: 'data/decks.json', cards: 'data/cards.json' };
  var CFG = window.KAIROS_CONFIG || {};

  function readJSON(k, d){ try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function writeJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  var local = readJSON(STORE_KEY, {});               // path -> body | {__deleted:true}
  var sync = readJSON(SYNC_KEY, {});                  // {meta:{path:ms}, dirty:{path:1}, since, uid}
  sync.meta = sync.meta || {}; sync.dirty = sync.dirty || {};
  var base = { decks: {}, cards: {} };                // public data from the repo
  var priv = { decks: {}, cards: {} };                // private data from Supabase
  var baseLoaded = false, listeners = [];

  function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function collOf(p){ return p.split('/')[0]; }
  function idOf(p){ return p.split('/').slice(1).join('/'); }
  function persist(){ var a = writeJSON(STORE_KEY, local), b = writeJSON(SYNC_KEY, sync); return a && b; }

  function lookup(coll, id){
    var p = coll + '/' + id;
    if (p in local && !(local[p] && local[p].__restored)) return local[p] && local[p].__deleted ? undefined : local[p];
    if (priv[coll] && id in priv[coll]) return priv[coll][id];
    return (base[coll] || {})[id];
  }
  function collectionDocs(coll){
    var out = {}, k, b = base[coll] || {}, pv = priv[coll] || {};
    for (k in b) out[k] = b[k];
    for (k in pv) out[k] = pv[k];
    for (k in local){
      if (collOf(k) !== coll) continue;
      if (local[k] && local[k].__restored) continue;
      if (local[k] && local[k].__deleted) delete out[idOf(k)]; else out[idOf(k)] = local[k];
    }
    return out;
  }
  function docSnap(path){
    var v = lookup(collOf(path), idOf(path));
    return { id: idOf(path), exists: v !== undefined, data: function(){ return clone(v); }, metadata: { fromCache: !baseLoaded, hasPendingWrites: false } };
  }
  function collSnap(coll){
    var docs = collectionDocs(coll), arr = Object.keys(docs).sort().map(function(id){
      var v = docs[id];
      return { id: id, exists: true, data: function(){ return clone(v); }, metadata: { fromCache: false, hasPendingWrites: false } };
    });
    return { docs: arr, size: arr.length, empty: !arr.length, metadata: { fromCache: !baseLoaded, hasPendingWrites: false }, docChanges: function(){ return []; } };
  }
  function emit(){
    listeners.forEach(function(l){ if (!l.dead) try { l.next(l.kind === 'coll' ? collSnap(l.path) : docSnap(l.path)); } catch (e) { console.error(e); } });
    notifyAccount();
  }
  var emitQueued = false;
  function emitSoon(){ if (emitQueued) return; emitQueued = true; setTimeout(function(){ emitQueued = false; emit(); }, 0); }

  function write(path, body){
    local[path] = body;
    sync.meta[path] = Math.max(Date.now(), (sync.meta[path] || 0) + 1);
    sync.dirty[path] = 1;
    if (!persist()) return Promise.reject({ code: 'quota_exceeded', message: 'Device storage is full.' });
    emitSoon(); syncSoon();
    return Promise.resolve();
  }

  window.addEventListener('storage', function(e){
    if (e.key === STORE_KEY || e.key === SYNC_KEY){ local = readJSON(STORE_KEY, {}); sync = readJSON(SYNC_KEY, {}); sync.meta = sync.meta || {}; sync.dirty = sync.dirty || {}; emitSoon(); }
  });

  function loadBase(){
    var names = Object.keys(DATA_FILES);
    return Promise.all(names.map(function(n){
      return fetch(DATA_FILES[n], { cache: 'no-cache' }).then(function(r){ if (!r.ok) throw new Error(n + ' ' + r.status); return r.json(); });
    })).then(function(res){
      var fresh = {}; names.forEach(function(n, i){ fresh[n] = res[i] || {}; }); base = fresh;
    }).catch(function(err){ console.warn('Kairos: could not load card data', err); })
      .then(function(){ baseLoaded = true; emitSoon(); });
  }

  /* ---------- account and sync ---------- */
  var sb = null, user = null, state = { syncing: false, lastSync: sync.lastSync || null, error: null };
  var accountListeners = [];
  function notifyAccount(){ accountListeners.forEach(function(f){ try { f(); } catch (e) {} }); }
  function configured(){ return !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient); }

  function mergeLog(a, b){
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function(e){ var k = e.c + '|' + e.t; if (!seen[k]){ seen[k] = 1; out.push(e); } });
    out.sort(function(x, y){ return x.t - y.t; });
    return out;
  }
  function resetLocal(){ local = {}; sync = { meta: {}, dirty: {} }; priv = { decks: {}, cards: {} }; persist(); }

  var syncTimer = null, running = null;
  function syncSoon(ms){ if (!user) return; clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms == null ? 1500 : ms); }
  function runSync(){
    if (!user || !sb) return Promise.resolve();
    if (running) return running;
    state.syncing = true; notifyAccount();
    running = (async function(){
      try {
        // push
        var paths = Object.keys(sync.dirty);
        for (var i = 0; i < paths.length; i += 200){
          var batch = paths.slice(i, i + 200), sent = {};
          var docs = batch.map(function(p){ sent[p] = sync.meta[p] || Date.now(); var v = local[p]; return { path: p, body: v && v.__deleted ? null : (v === undefined ? null : v), updated_at: sent[p] }; });
          var r = await sb.rpc('put_docs', { docs: docs });
          if (r.error) throw r.error;
          batch.forEach(function(p){ if (sync.meta[p] === sent[p]) delete sync.dirty[p]; });
        }
        // pull
        for (var guard = 0; guard < 50; guard++){
          var q = sb.from('user_docs').select('path,body,updated_at,server_at').order('server_at', { ascending: true }).limit(1000);
          if (sync.since) q = q.gt('server_at', sync.since);
          var res = await q;
          if (res.error) throw res.error;
          var rows = res.data || [];
          rows.forEach(function(row){
            var p = row.path, lm = sync.meta[p] || 0, ru = Number(row.updated_at);
            if (p.indexOf('log/') === 0){
              var mine = local[p] && !local[p].__deleted ? local[p].entries : [];
              var theirs = row.body ? row.body.entries : [];
              var merged = mergeLog(mine, theirs);
              local[p] = { entries: merged };
              if (merged.length !== (theirs || []).length){ sync.meta[p] = Math.max(Date.now(), ru + 1); sync.dirty[p] = 1; }
              else { sync.meta[p] = Math.max(lm, ru); delete sync.dirty[p]; }
            } else if (ru > lm){
              local[p] = row.body === null ? { __deleted: true } : row.body;
              sync.meta[p] = ru; delete sync.dirty[p];
            }
            if (!sync.since || row.server_at > sync.since) sync.since = row.server_at;
          });
          if (rows.length < 1000) break;
        }
        // private decks
        var pr = await sb.from('private_docs').select('coll,id,body');
        if (!pr.error){
          var np = { decks: {}, cards: {} };
          (pr.data || []).forEach(function(row){ var v = row.body; if (row.coll === 'decks') v = Object.assign({}, v, { private: true }); np[row.coll][row.id] = v; });
          priv = np;
        }
        state.lastSync = sync.lastSync = Date.now(); state.error = null;
        persist(); emitSoon();
        if (Object.keys(sync.dirty).length) syncSoon(500);
      } catch (e) {
        state.error = (e && (e.message || e.msg)) || String(e);
      } finally {
        state.syncing = false; running = null; notifyAccount();
      }
    })();
    return running;
  }

  async function onUser(u){
    var prev = user; user = u;
    if (u){
      if (sync.uid && sync.uid !== u.id) resetLocal();   // another account used this device
      sync.uid = u.id; persist();
      if (!prev || prev.id !== u.id) await runSync();
    }
    notifyAccount(); emitSoon();
  }
  function initAuth(){
    if (!configured()) return;
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kairos.auth' } });
    sb.auth.getSession().then(function(r){ onUser(r && r.data && r.data.session ? r.data.session.user : null); });
    sb.auth.onAuthStateChange(function(ev, session){ var u = session ? session.user : null; if ((u && u.id) !== (user && user.id)) onUser(u); });
    window.addEventListener('online', function(){ syncSoon(0); });
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) syncSoon(0); });
    setInterval(function(){ syncSoon(0); }, 60000);
  }

  var account = {
    configured: configured,
    user: function(){ return user ? { email: user.email, id: user.id } : null; },
    state: function(){ return { syncing: state.syncing, lastSync: state.lastSync, error: state.error, pending: Object.keys(sync.dirty).length }; },
    onChange: function(f){ accountListeners.push(f); },
    sendCode: async function(email){
      var r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
      if (r.error) throw r.error;
    },
    verify: async function(email, code){
      var r = await sb.auth.verifyOtp({ email: email, token: code, type: 'email' });
      if (r.error) throw r.error;
      await onUser(r.data.user || (r.data.session && r.data.session.user));
    },
    signOut: async function(){
      try { await runSync(); } catch (e) {}
      await sb.auth.signOut();
      resetLocal(); user = null; notifyAccount(); emitSoon();
    },
    syncNow: function(){ return runSync(); }
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
  initAuth();
  // Public cards this device deleted (before flagging existed). The app offers to restore them.
  function hiddenPublic(){
    var out = [];
    for (var k in local){
      if (collOf(k) !== 'cards' || !(local[k] && local[k].__deleted)) continue;
      var id = idOf(k), b = base.cards[id] || priv.cards[id];
      if (b) out.push({ id: id, front: b.front || '' });
    }
    return out;
  }
  window.KAIROS_WEB = { reload: loadBase, account: account, hiddenPublic: hiddenPublic, exportProgress: function(){ return clone(local); } };
  window.claude = { use: function(name){ return Promise.resolve(name === 'db' ? db : null); } };
})();
