// Zaryn Service Worker v1
const CACHE = 'zaryn-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — serve from cache when offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/.netlify/functions/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/index.html')))
  );
});

// Push notification received
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'Zaryn';
  const body = data.body || 'A new dilemma is waiting for you.';
  const icon = data.icon || '/manifest.json';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag: 'zaryn-daily',
      renotify: true,
      data: { url: data.url || '/' },
      actions: [
        { action: 'answer', title: 'Answer now →' },
        { action: 'later', title: 'Later' }
      ]
    })
  );
});

// Notification click — open app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/index.html';
  if (e.action === 'answer' || !e.action) {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
        const match = wins.find(w => w.url.includes('zaryn'));
        if (match) return match.focus();
        return clients.openWindow(url);
      })
    );
  }
});

// Daily notification alarm via message
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { time, messages } = e.data;
    scheduleDaily(time, messages);
  }
});

let _alarmTimeout = null;

function scheduleDaily(timeStr, messages) {
  if (_alarmTimeout) clearTimeout(_alarmTimeout);
  const now = new Date();
  const [h, m] = timeStr.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next - now;
  _alarmTimeout = setTimeout(() => {
    const msg = messages[Math.floor(Math.random() * messages.length)];
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: 'zaryn-daily',
      renotify: true,
      data: { url: '/index.html' },
      actions: [{ action: 'answer', title: 'Answer now →' }]
    });
    scheduleDaily(timeStr, messages); // reschedule for tomorrow
  }, ms);
}
