var CACHE_NAME = 'amandata-cache-v3';
var OFFLINE_URL = './index.html';

var PRECACHE_ASSETS = [
  './',
  './index.html',
  './register.html',
  './manifest.json'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return Promise.allSettled(
          PRECACHE_ASSETS.map(function(url) {
            return cache.add(new Request(url, { cache: 'reload' }));
          })
        );
      })
      .then(function() {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(cacheName) {
          return cacheName !== CACHE_NAME;
        }).map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;

  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function(response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(req, copy);
          });
          return response;
        })
        .catch(function() {
          return caches.match(req).then(function(cached) {
            return cached || caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(req, copy);
          });
        }
        return response;
      });
    })
  );
});

self.addEventListener('push', function(event) {
  var notificationData = 'New update AmanData!';
  if (event.data) {
    notificationData = event.data.text();
  }
  var options = {
    body: notificationData,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: './index.html'
    }
  };
  event.waitUntil(
    self.registration.showNotification('AmanData', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = new URL('./index.html', self.location.origin).href;
  if (event.notification.data && event.notification.data.url) {
    targetUrl = new URL(event.notification.data.url, self.location.origin).href;
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
