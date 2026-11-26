/* global io */
// QuizParty — Connexion temps réel : socket, horloge serveur (façon NTP), send(), état global (state, pending).
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  socket & horloge

const socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });

/**
 * Synchronisation d'horloge (principe de NTP) :
 * on envoie un ping, le serveur répond avec son heure. En supposant le trajet symétrique,
 * l'heure serveur correspond au milieu de l'aller-retour. On garde l'échantillon au plus
 * petit aller-retour, c'est le plus fiable.
 */
const clock = { offset: 0, samples: [] };
const now = () => Date.now() + clock.offset;
// Heure d'affichage : figée à l'heure serveur de la pause quand l'hôte a mis la partie en pause,
// donc tous les chronos, barres et jaquettes s'arrêtent au même temps restant chez tout le monde.
const shownNow = () => (state?.paused ? state.paused.at : now());

function sampleClock() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const wall0 = Date.now();
    socket.timeout(4000).emit('time:ping', null, (err, serverTime) => {
      if (!err && typeof serverTime === 'number') {
        const rtt = performance.now() - t0;
        clock.samples.push({ rtt, offset: serverTime - (wall0 + rtt / 2) });
        if (clock.samples.length > 12) clock.samples.shift();
        clock.offset = clock.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
      }
      resolve();
    });
  });
}
async function syncClock(n) {
  for (let i = 0; i < n; i++) {
    await sampleClock();
    await new Promise((r) => setTimeout(r, 80));
  }
}
setInterval(() => { if (socket.connected) sampleClock(); }, 15000);

function send(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, payload, (err, res) => resolve(err ? { error: 'Pas de réponse du serveur' } : res || {}));
  });
}

// =====================================================================  état
let state = null;          // dernier état reçu du serveur
let pending = null;        // réponse envoyée mais pas encore confirmée {roundId, answer}
let renderedPhase = null;  // phase actuellement affichée
let resuming = !SCREEN && !!store.get(SESSION_KEY);

socket.on('connect', async () => {
  $('#conn').hidden = true;
  await syncClock(state ? 3 : 5);
  if (SCREEN) await tvConnect();
  else {
    await accountSync();
    await resume();
    loadDaily();
  }
});
