// QuizParty — Démarrage, une fois tous les scripts chargés (les tâches asynchrones ne partent qu'ici,
// pour qu'aucune ne s'exécute avant que render() & co soient définis).
'use strict';

if (!SCREEN) accountConfig().then(() => { if (account.cfg?.enabled) render(); });
fetch('/api/avatars').then((r) => r.json()).then((x) => { Object.assign(looks, x); render(); }).catch(() => {});
// Lien partagé (…/?defi) : le défi s'ouvre directement
if (!SCREEN && new URLSearchParams(location.search).has('defi')) {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => { if (!state) openSheet('daily'); }, 0);
}
socket.connect();
render();
requestAnimationFrame(frame);
// Arrivée par le QR code « L'app sur ton téléphone » : on ouvre directement la fenêtre d'installation
if (new URLSearchParams(location.search).has('install')) {
  history.replaceState(null, '', location.pathname);
  if (!STANDALONE && !SCREEN && displayPhase() === 'home') openSheet('getapp');
}
