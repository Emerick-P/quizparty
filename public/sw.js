// Service worker minimal : il rend l'app installable (écran d'accueil, plein écran) sans rien mettre en cache,
// et affiche les notifications des quiz en direct (server/push.js, public/js/notify.js).
// Le jeu est en temps réel : on ne sert jamais une ancienne version, tout passe par le réseau.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || '%APP%', {
    body: d.body || '', tag: d.slot || 'direct', icon: '/icon-192.png', data: { slot: d.slot || '' },
  }));
});

// Toucher la notification : l'app déjà ouverte passe devant, sinon il s'ouvre sur le direct
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const slot = e.notification.data?.slot || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname === '/'); // ni la télé, ni le formulaire
    if (!open) return self.clients.openWindow(`/?direct=${encodeURIComponent(slot)}`);
    open.postMessage({ type: 'quizparty:direct', slot });
    return open.focus();
  }));
});
