// NexBot Service Worker — Push Notifications
self.addEventListener('push', function (event) {
  const data = event.data ? event.data.json() : {}

  const title = data.title || '🔔 NexBot'
  const options = {
    body: data.body || 'Tienes una nueva notificación',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/dashboard',
    },
    actions: data.actions || [],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const url = event.notification.data?.url || '/dashboard'
  event.waitUntil(clients.openWindow(url))
})
