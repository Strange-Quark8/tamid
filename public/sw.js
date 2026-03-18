// Tamid Service Worker — handles push notifications

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Listen for push events (for future FCM integration)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Tamid — Daily Tzedakah';
  const options = {
    body: data.body || "Good morning — reminder to complete your daily donation! It goes a long way.",
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'tamid-daily-reminder',
    renotify: true,
    data: { url: '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});

// Periodic background sync (for daily reminders)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'tamid-daily-check') {
    event.waitUntil(
      self.registration.showNotification('Tamid — Daily Tzedakah', {
        body: "Good morning — reminder to complete your daily donation! It goes a long way.",
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'tamid-daily-reminder',
      })
    );
  }
});
