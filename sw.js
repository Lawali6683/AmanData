const CACHE_NAME = 'amandata-cache-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index',
  '/register'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS_TO_CACHE).catch(function() {
        return Promise.resolve();
      });
    }).then(() => self.skipWaiting())
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
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match('/register') || caches.match('/');
      })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('push', function(event) {
  let notificationData = 'New update from AmanData!';
  if (event.data) {
    notificationData = event.data.text();
  }
  const options = {
    body: notificationData,
    icon: 'https://i.imgur.com/SBHTDNn.png',
    badge: 'https://i.imgur.com/SBHTDNn.png',
    vibrate: [100, 50, 100],
    data: {
      url: 'https://www.amandata.com.ng/register'
    }
  };
  event.waitUntil(
    self.registration.showNotification('AmanData', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  let targetUrl = 'https://www.amandata.com.ng/register';
  if (event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url;
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
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
