/**
 * ============================================================================
 * LITTLE BLOOM PRO - SERVICE WORKER (PWA & OFFLINE CACHING)
 * ============================================================================
 */

const CACHE_NAME = 'mimi-cache-v3.0.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install Event: Pre-cache static assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate Event: Clear all old caches immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('Clearing old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-First strategy with Cache Fallback for instant live updates
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Return cached version if offline
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
        });
      })
  );
});

// Push Notification Listener
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Little Bloom Reminder 🌷';
  const options = {
    body: data.body || 'Time for your scheduled mindful plan!',
    icon: 'icons/icon.svg',
    badge: 'icons/icon.svg',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification Click Listener
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
