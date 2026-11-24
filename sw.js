// Neurova service worker.
//
// Network-first, deliberately. The obvious thing for a service worker to do is serve
// from cache and update in the background, and that is exactly wrong for this site: the
// pages are cache-busted with ?v= on every release, and a worker that preferred its own
// copy would hand back last week's shared.js while the HTML asked for this week's. That
// failure mode has already cost this project an afternoon without a service worker in
// the picture at all.
//
// So: always try the network, cache whatever comes back, and fall back to the cache only
// when the network cannot be reached. Online, the worker is invisible. Offline, the site
// still opens and every page already visited still works.

const CACHE = 'neurova-runtime-v2';

self.addEventListener('install', () => {
  // Take over straight away rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Same-origin only. Firebase auth and Firestore, and the Google Fonts stylesheets, must
  // reach the network untouched -- caching an auth response would be both useless and a
  // way to serve one visitor's state to another.
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // Offline and no exact match. Assets are requested with ?v= and that string
          // changes every release, so the copy already on disk is almost always under a
          // slightly different URL. Ignoring the query finds it. Pairing last release's
          // CSS with this release's HTML is imperfect, but it is the difference between
          // a site that opens offline and one that does not, and online this branch is
          // never reached.
          return caches.match(req, { ignoreSearch: true }).then((loose) => {
            if (loose) return loose;
            // The app-shell fallback is for navigations ONLY. It used to be returned
            // for any same-origin GET that missed, which meant a failed image, script
            // or stylesheet fetch was answered with an HTML document. That is not a
            // degraded response, it is the wrong type: a PNG request handed index.html
            // does not render, and the one that bit was apple-touch-icon.png, where a
            // single bad fetch is enough because iOS caches a web clip's icon hard and
            // does not go back for it.
            if (req.mode === 'navigate') {
              return caches.match('./index.html', { ignoreSearch: true });
            }
            return Response.error();
          });
        })
      )
  );
});
