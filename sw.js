const CACHE_NAME = 'apex-mobile-cloud-v1';
const ASSETS = ['./', './index.html', './cloud.js', './vendor/supabase-2.57.4.js', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('apex-mobile-') && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  // Never cache Supabase/Auth/API responses or external requests.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  if (!['/', '/index.html', '/cloud.js', '/vendor/supabase-2.57.4.js', '/manifest.json', '/icon-192.png', '/icon-512.png'].includes(path)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const clone = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)); }
    return response;
  }).catch(() => caches.match(event.request)));
});
