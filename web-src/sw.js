/* Kairos service worker: makes the site open with no connection.
   - App shell (page, icons, manifest) and MathJax: cache first, refreshed in the background.
   - Card data (data/*.json): network first, so new cards arrive; cache when offline.
   - Fonts and MathJax extensions: cached the first time they load. */
const VERSION = '__BUILD__';
const SHELL = 'kairos-shell-' + VERSION;
const RUNTIME = 'kairos-runtime';
const MATHJAX = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Marcellus&family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=JetBrains+Mono:wght@400;600&display=swap';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './data/decks.json', './data/cards.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE);
    const rt = await caches.open(RUNTIME);
    for (const u of [MATHJAX, SUPABASE_JS]) { try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await rt.put(u, r); } catch (err) {} }
    // Fonts: cache the stylesheet and every font file it points to, so text looks right offline.
    try {
      const css = await fetch(FONTS_CSS, { mode: 'cors' });
      if (css.ok) {
        const text = await css.clone().text();
        await rt.put(FONTS_CSS, css);
        const urls = [...text.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
        await Promise.all(urls.map(async u => { try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await rt.put(u, r); } catch (err) {} }));
      }
    } catch (err) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('kairos-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const r = await fetch(req, { cache: 'no-cache' });
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req, { ignoreSearch: cacheName === SHELL });
  const refresh = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => null);
  if (hit) return hit;
  const r = await refresh;
  if (r) return r;
  return new Response('', { status: 504, statusText: 'offline' });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/data/')) { e.respondWith(networkFirst(req)); return; }
    if (req.mode === 'navigate') { e.respondWith(networkFirst(new Request('./index.html')).catch(() => caches.match('./index.html'))); return; }
    e.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (/^(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith(cacheFirst(req, RUNTIME));
  }
});
