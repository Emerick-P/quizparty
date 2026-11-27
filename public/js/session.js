/* global io */
// QuizParty — Compte (Discord/Google), écran télé, événements du serveur, reprise de session, phase affichée.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  compte (facultatif)
// Connexion Discord / Google via Supabase : le site part chez Supabase, qui revient ici avec les jetons
// dans l'adresse (#access_token=…). On les garde sur l'appareil, on les passe au serveur, qui les fait
// vérifier par Supabase. Les droits d'admin sont décidés par le serveur, jamais par le navigateur.
const account = { cfg: null, user: store.get(AUTH_KEY)?.user ?? null, timer: null, busy: false };
const PROVIDER_LABEL = { discord: 'Discord', google: 'Google' };
(function readAuthRedirect() {
  if (SCREEN || !/[#&](access_token|error)=/.test(location.hash)) return;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (h.get('access_token')) {
    const exp = Number(h.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(h.get('expires_in')) || 3600);
    store.set(AUTH_KEY, { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: exp, user: null });
    account.justIn = true;
  } else {
    account.failed = h.get('error_description') || h.get('error');
  }
})();
async function accountConfig() {
  if (account.cfg) return account.cfg;
  try {
    const r = await fetch('/api/auth/config', { cache: 'no-store' });
    if (r.ok) account.cfg = await r.json();
  } catch { /* hors ligne : pas de bouton de connexion pour l'instant */ }
  return account.cfg;
}
async function accountRefresh(s) {
  try {
    const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (r.status === 401) return null; // session révoquée : il faut se reconnecter
    if (!r.ok) return s; // serveur ou réseau indisponible : on garde la session et on réessaiera
    return { ...s, ...(await r.json()) };
  } catch { return s; }
}
/** Passe le jeton au serveur (à chaque connexion), en le renouvelant s'il expire bientôt. */
async function accountSync() {
  if (account.failed) { toast(`Connexion annulée${account.failed === 'access_denied' ? '' : ` : ${account.failed}`}`); account.failed = null; }
  let s = store.get(AUTH_KEY);
  clearTimeout(account.timer);
  if (!s?.access_token) { account.user = null; return; }
  if (s.expires_at * 1000 - Date.now() < 5 * 60_000 && s.refresh_token) {
    s = await accountRefresh(s);
    if (!s) return accountLost();
    store.set(AUTH_KEY, s);
  }
  const r = await send('auth:set', { token: s.access_token });
  if (r.user) {
    account.user = r.user;
    if (r.user.look != null) store.set(LOOK_KEY, r.user.look); // l'image du compte suit le joueur partout
    store.set(AUTH_KEY, { ...s, user: r.user });
    // Pseudo : celui du compte s'il en a un ; sinon celui de l'appareil, enregistré sur le compte
    if (r.user.nickname) store.set(NAME_KEY, r.user.nickname);
    else {
      if (!store.get(NAME_KEY)) store.set(NAME_KEY, [...r.user.name].slice(0, 16).join('').trim());
      send('profile:name', { name: store.get(NAME_KEY) });
    }
    if (account.justIn) { account.justIn = false; toast(`Connecté avec ${PROVIDER_LABEL[r.user.provider] || 'ton compte'} : ${r.user.name}`); }
  } else if (r.error && !/serveur/.test(r.error)) {
    // Jeton refusé : une tentative de renouvellement, sinon on repasse en invité
    const again = s.refresh_token ? await accountRefresh({ ...s, expires_at: 0 }) : null;
    if (!again || again.access_token === s.access_token) return accountLost();
    store.set(AUTH_KEY, again);
    return accountSync();
  }
  // Renouvellement automatique 5 min avant l'expiration (le jeton dure 1 h)
  const wait = Math.max(30_000, (store.get(AUTH_KEY)?.expires_at ?? 0) * 1000 - Date.now() - 4 * 60_000);
  account.timer = setTimeout(() => { if (socket.connected) accountSync().then(render); }, wait);
  render();
}
function accountLost() {
  store.del(AUTH_KEY);
  account.user = null;
  send('auth:clear');
  toast('Session expirée : reconnecte-toi pour retrouver ton compte');
  render();
}


/** Écran télé : reprend son salon (après un rechargement), sinon affiche un code d'appairage. */
async function tvConnect() {
  const saved = store.get(TV_KEY);
  if (saved) {
    const r = await send('screen:resume', saved);
    if (!r.error) return;
    store.del(TV_KEY);
  }
  state = null;
  const r = await send('screen:hello');
  tv.pin = r.pin || null;
  render();
}
socket.on('screen:paired', ({ code, token }) => {
  store.set(TV_KEY, { code, token });
});
socket.on('screen:closed', () => {
  store.del(TV_KEY);
  state = null;
  tvConnect();
});
socket.on('disconnect', () => { $('#conn').hidden = false; });
socket.on('state', (s) => {
  state = s;
  // Les images sont chargées pendant le « 3, 2, 1 » (et dès la correction précédente) pour être prêtes à l'heure
  if (s.round?.image) loadImage(s.round.image.levels?.[0]?.url); // jaquette : premier palier seulement
  if (s.round?.sound) loadSound(s.round.sound.url);
  if (s.preload) (s.preload.startsWith('/sfx/') ? loadSound : loadImage)(s.preload);
  if (s.round?.picture) loadImage(s.round.picture.url);
  if (pending && (!s.round || s.round.id !== pending.roundId || s.round.yourAnswer !== null)) pending = null;
  autoLinkSteam();
  if (s.daily && !s.daily.live) rememberDaily(s);
  render();
});

/** Profil Steam retenu sur l'appareil : relié tout seul en entrant dans un salon (une fois par salon). */
let steamAutoFor = null;
function autoLinkSteam() {
  const me = state?.players?.find((p) => p.id === state.you);
  const saved = store.get(STEAM_KEY);
  const key = `${state?.code}:${state?.you}`;
  if (!me || me.steam || !saved || steamAutoFor === key) return;
  steamAutoFor = key;
  send('steam:link', { profile: saved });
}
socket.on('srv:ping', (_t, ack) => { if (typeof ack === 'function') ack(); });
socket.on('kicked', () => leaveLocal("L'hôte t'a retiré du salon"));
socket.on('session:replaced', () => {
  state = null;
  render();
  toast('Ta session a été ouverte ailleurs');
});

async function resume() {
  const s = store.get(SESSION_KEY);
  if (!s) { resuming = false; render(); return; }
  const res = await send('room:resume', s);
  resuming = false;
  if (res.error) {
    store.del(SESSION_KEY);
    state = null;
    if (urlCode() === s.code) setUrlCode('');
    toast(res.error);
    render();
  }
}

function enterRoom(res) {
  store.set(SESSION_KEY, { code: res.code, token: res.token });
  setUrlCode(res.code);
}

function leaveLocal(message) {
  store.del(SESSION_KEY);
  state = null;
  pending = null;
  setUrlCode('');
  render();
  if (message) toast(message);
}

// La phase "question" commence à r.startsAt selon l'horloge serveur : on bascule localement
// à l'instant exact, sans attendre le message du serveur (qui arrive avec la latence).
function displayPhase() {
  if (SCREEN) {
    if (!state) return 'tvpair';
    if (state.phase === 'lobby') return 'tvlobby';
  } else if (!state) return resuming ? 'loading' : 'home';
  if (state.phase === 'countdown' && state.round && shownNow() >= state.round.startsAt) return 'question';
  return state.phase;
}
