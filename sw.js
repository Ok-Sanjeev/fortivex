/**
 * FORTIVEX Service Worker (sw.js)
 * Cache version: fortivex-v2.0.2
 * Network-First Strategy with immediate cache purge of legacy 'barricade-cache-v1'
 */

const CACHE_NAME = 'fortivex-cache-v2.0.2';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './game.js',
    './ui.js',
    './ai.js',
    './audio.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    // Forcefully delete old barricade cache
                    if (key !== CACHE_NAME) {
                        console.log('Purging legacy cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Network-First strategy: Always fetch freshest files from server first!
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // Never cache API or websocket requests
    if (event.request.url.includes('/api/')) return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Offline fallback
                return caches.match(event.request);
            })
    );
});
