'use strict';

const CACHE = 'botanika-ai-v3';
const ASSETS = ['./', './Botanika-AI%20(1).html', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE).then(cache => cache.addAll(ASSETS)),
      self.skipWaiting()
    ])
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('botanika-ai-') && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        event.waitUntil(
          caches.open(CACHE).then(cache => cache.put(event.request, response.clone()))
        );
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        return (await caches.match('./Botanika-AI%20(1).html')) || caches.match('./');
      }
      return Response.error();
    }
  })());
});
