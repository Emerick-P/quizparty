// QuizParty — Démarrage, une fois tous les scripts chargés (les tâches asynchrones ne partent qu'ici,
// pour qu'aucune ne s'exécute avant que render() & co soient définis).
'use strict';

if (!SCREEN) accountConfig().then(() => { if (account.cfg?.enabled) render(); });
fetch('/api/avatars').then((r) => r.json()).then((x) => { Object.assign(looks, x); render(); }).catch(() => {});
// Lien d'un score de direct (…/?r=<jeton>) : l'aperçu est fait par le serveur, on arrive sur l'accueil
if (new URLSearchParams(location.search).has('r')) history.replaceState(null, '', location.pathname);
// Lien partagé (…/?defi) : le défi s'ouvre directement
if (!SCREEN && new URLSearchParams(location.search).has('defi')) {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => { if (!state) openSheet('daily'); }, 0);
}
// Lien d'un défi entre potes (…/?c=CODE)
const potesUrl = !SCREEN && new URLSearchParams(location.search).get('c');
if (potesUrl) {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => { if (!state) actions.defiopen({ dataset: { value: potesUrl.toUpperCase() } }); }, 0);
}
// Notification d'un direct touchée alors que QuizParty était fermé (…/?direct=<créneau>)
const directUrl = !SCREEN && new URLSearchParams(location.search).get('direct');
if (typeof directUrl === 'string') {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => { if (!state) openDirect(directUrl); }, 0);
}
socket.connect();
render();
requestAnimationFrame(frame);
if (!SCREEN && store.get(NOTIFY_KEY)) loadLive(); // abonnement aux directs remis d'accord avec le serveur
// Arrivée par le QR code « L'app sur ton téléphone » : on ouvre directement la fenêtre d'installation
if (new URLSearchParams(location.search).has('install')) {
  history.replaceState(null, '', location.pathname);
  if (!STANDALONE && !SCREEN && displayPhase() === 'home') openSheet('getapp');
}
