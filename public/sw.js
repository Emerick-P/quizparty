// Service worker minimal : il rend l'app installable (écran d'accueil, plein écran) sans rien mettre en cache.
// Le jeu est en temps réel : on ne sert jamais une ancienne version, tout passe par le réseau.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
