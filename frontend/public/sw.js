self.addEventListener('push', (event) => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title || 'NexBot', {
      body:  data.body  || '',
      icon:  data.icon  || '/icon.svg',
      badge: data.badge || '/icon.svg',
      data:  data.data  || {},
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/dashboard'))
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(() => fetch('/'))
  )
})
