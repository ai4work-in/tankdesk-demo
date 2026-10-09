/* ==========================================================================
   sw.js: the service worker. It keeps the app's own files (the "app shell")
   on the phone, so the app opens fast and even on a weak signal.

   - It NEVER stores server answers (orders, payments): those always come
     fresh from Google Apps Script.
   - POST requests and Google Apps Script addresses are never touched.
   - App files: the newest copy is fetched first; if the web host does not
     answer within 2.5 seconds (weak signal, offline) the saved copy is used.
     If a file changed, the page is told, and it shows
     "નવું વર્ઝન તૈયાર છે · ફરી ખોલો" (new version ready · reload).
   - Fonts from Google are kept too, and refreshed in the background.

   Bump the version below (v3 -> v4...) on every deploy: then the new
   service worker takes over at once and clears the old saved files.
   ========================================================================== */

const SHELL_CACHE = 'td-demo-v28';   // bump this on every deploy
const FONT_CACHE = 'td-fonts-v1';    // Google Fonts (rarely needs a bump)

// The app files to keep on the phone
const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'admin.css',
  'chat.css',
  'phone.css',
  'common.js',
  'api.js',
  'mock-api.js',
  'app.js',
  'chat.js',
  'tank-editor.js',
  'admin-orders.js',
  'admin-insights.js',
  'admin-reports.js',
  'admin-logbook.js',
  'driver.js',
  'collector.js',
  'supervisor.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// Install: download all app files (skipping the browser's own HTTP cache) and keep them.
// skipWaiting = the new version takes over at once, without waiting for every tab to close.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete saved files from older versions and take control of open pages.
// If an older version was there, this is an update: tell the open pages.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k !== SHELL_CACHE && k !== FONT_CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    if (old.some(k => k.indexOf('td-shell-') === 0)) await tellPages();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                     // never touch POST (all server calls are POST)
  const url = new URL(req.url);
  if (/(^|\.)script\.google\.com$|googleusercontent\.com$/.test(url.hostname)) return;   // the server: always live

  // Google Fonts: answer from the cache at once, refresh it in the background
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Our own files: saved copy at once, newest copy fetched in the background
  if (url.origin === self.location.origin) event.respondWith(shellFile(event));
});

/**
 * One app file, stale-while-revalidate:
 *  - saved copy -> answer with it at once, and refresh it in the background
 *  - no saved copy -> get it from the network (and save it)
 */
async function shellFile(event) {
  const req = event.request;
  const cache = await caches.open(SHELL_CACHE);
  // Opening the app (any "?mock=1" etc. ignored) is saved and answered as index.html
  const nav = req.mode === 'navigate';
  const key = nav ? 'index.html' : req;
  const hit = nav
    ? (await cache.match('index.html')) || (await cache.match('./'))
    : await cache.match(req, { ignoreSearch: true });

  // A second copy of the saved file to compare with (the first one goes to the page)
  const old = hit ? hit.clone() : null;

  // Fetch the newest copy ('no-cache' = always check with the web host)
  const fresh = fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
    .then(async res => {
      if (!res || !res.ok || res.type !== 'basic') return res;
      if (old && await sameContent(old, res.clone())) return res;   // nothing changed
      await cache.put(key, res.clone());
      if (hit) await tellPages();                                 // a file changed: new version ready
      return res;
    });

  if (hit) {
    event.waitUntil(fresh.catch(() => {}));   // keep the worker alive until the refresh is saved; offline is fine
    // Newest copy first, if the web host answers within 2.5 seconds (small files, so this is quick).
    // Weak signal or offline: use the saved copy. This way an update is never stuck behind an old copy.
    const quick = fresh.then(res => (res && res.ok ? res : hit)).catch(() => hit);
    const slow = new Promise(r => setTimeout(() => r(hit), 2500));
    return Promise.race([quick, slow]);
  }
  return fresh;
}

// Are two copies of a file the same? (compares the text of the file)
async function sameContent(a, b) {
  try {
    const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    if (x.byteLength !== y.byteLength) return false;
    const u = new Uint8Array(x), v = new Uint8Array(y);
    for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
    return true;
  } catch (e) { return false; }
}

// Tell every open page of the app that a new version is ready (the page shows a short notice)
async function tellPages() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach(c => c.postMessage({ type: 'td-update' }));
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || fresh;
}
