'use strict';
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'Digi Partner';
  const options = {
    body: payload.body || '육성 상태 알림이 도착했습니다.',
    tag: payload.tag || 'digi-partner-notice',
    renotify: false,
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
