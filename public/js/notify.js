// QuizParty — Notifications des directs (cloches, profil) et programme de la semaine.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  notifications des directs
// Une seule notification par direct, à l'ouverture de la salle d'attente (server/push.js).
// Compte connecté : les choix sont ceux du compte, les mêmes sur tous ses appareils ; chaque appareil doit en
// plus être activé (autorisation du navigateur). Invité : les choix sont ceux de l'appareil.
// L'autorisation n'est demandée qu'au premier appui sur une cloche ou une coche, ou sur « Activer ».
// Compte avec des rappels sur un appareil pas encore activé : une popup le propose, une seule fois par appareil.
const NOTIFY_KEY = 'quizparty:notify'; // { endpoint, prefs, account, here }
const NOTIFY_ASKED_KEY = 'quizparty:notify-asked'; // popup montrée ou activation refusée ici : plus jamais proposée seule
const NO_PREFS = { every: false, formats: [], slots: [] };
// key : clé publique du serveur (absente = notifications désactivées) ; program : créneaux de la semaine ;
// prefs : mes choix ; here : cet appareil est inscrit ; at : dernière mise d'accord avec le serveur
const notify = { key: null, program: [], prefs: store.get(NOTIFY_KEY)?.prefs ?? NO_PREFS, here: !!store.get(NOTIFY_KEY)?.here, slot: null, busy: false, at: 0 };
const NOTIFY_OK = !SCREEN && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const NOTIFY_IOS = IOS && !STANDALONE; // iPhone : seulement dans l'app installée sur l'écran d'accueil
/** Cloches affichées : le serveur sait envoyer et l'appareil peut recevoir (ou iPhone, pour dire comment). */
const notifyShown = () => !!notify.key && (NOTIFY_OK || NOTIFY_IOS);
const notifyAllowed = () => NOTIFY_OK && !NOTIFY_IOS && Notification.permission === 'granted';
const hasChoices = (p) => !!(p && (p.every || p.formats?.length || p.slots?.length));
/** Cet appareil reçoit bien les notifications. */
const notifyHere = () => notify.here && notifyAllowed();
/** Des rappels actifs sur le compte, que cet appareil ne reçoit pas (rien pendant un enregistrement). */
const notifyAway = () => !!account.user && notifyShown() && !notify.busy && hasChoices(notify.prefs) && !notifyHere();
/** Mes choix affichés : ceux du compte ; en invité, ceux de l'appareil (rien sans l'autorisation du navigateur). */
const notifyPrefs = () => (account.user || notifyAllowed() ? notify.prefs : NO_PREFS);
const notifyCovers = (s) => { const p = notifyPrefs(); return p.every || p.formats.includes(s.format) || p.slots.includes(s.id); };

// ---- programme de la semaine
const WEEK_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DAYS_TEXT = { '0123456': 'tous les jours', 12345: 'en semaine', 123456: 'du lundi au samedi', '06': 'samedi et dimanche', 0: 'le dimanche', 6: 'le samedi' };
const hourText = (hm) => hm.replace(/^0/, '').replace(':00', ' h').replace(':', ' h ');
const daysText = (days) => DAYS_TEXT[[...days].sort().join('')] || days.map((d) => WEEK_DAYS[d]).join(', ');
const ALL_OF = { midi: 'Toutes les Pause déj', soir: 'Tous les Apéro', nuit: 'Tous les Hardcore', finale: 'Toutes les finales' };
const DIFFICULTY = { easy: 'Facile', mixed: 'Variée', hard: 'Difficile', ramp: 'Croissante' };
/** Un créneau par format : { id, name, diff, about, rounds, when: « tous les jours à 12 h 45 » }. */
function liveFormats() {
  const out = new Map();
  for (const e of notify.program) {
    const when = `${daysText(e.days)} à ${hourText(e.time)}`;
    const f = out.get(e.id);
    if (f) f.when += ` · ${when}`;
    else out.set(e.id, { ...e, when });
  }
  return [...out.values()];
}
/** À côté du titre « Quiz en direct » : le programme (chaque direct expliqué, avec sa cloche). */
const programLink = () => (notify.program.length
  ? `<button class="l-prog" data-action="sheet" data-value="week">${ico('calendar')} Programme ›</button>` : '');

// ---- abonnement du navigateur
/** Autorisation du navigateur. À appeler tout de suite dans le geste du joueur (exigence des navigateurs). */
function notifyAsk() {
  if (!NOTIFY_OK || NOTIFY_IOS) return Promise.resolve('unsupported');
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return Promise.resolve(Notification.requestPermission()).then((p) => { render(); return p; });
}
const keyBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
async function notifySubscription() {
  // « ready » ne répond jamais si le service worker n'a pas pu s'installer : on n'attend pas sans fin
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_r, no) => setTimeout(() => no(new Error('service worker absent')), 8000))]);
  const key = keyBytes(notify.key);
  let sub = await reg.pushManager.getSubscription();
  const old = sub?.options?.applicationServerKey;
  if (old && String(new Uint8Array(old)) !== String(key)) { await sub.unsubscribe(); sub = null; } // clés du serveur changées
  return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}
/** Retient sur l'appareil mes choix et son inscription. */
function notifyRemember(sub, prefs, here) {
  notify.prefs = prefs;
  notify.here = here;
  store.set(NOTIFY_KEY, { endpoint: sub?.endpoint ?? store.get(NOTIFY_KEY)?.endpoint, prefs, account: !!account.user, here });
}
function notifyForget() {
  store.del(NOTIFY_KEY);
  notify.prefs = NO_PREFS;
  notify.here = false;
}
const notifyError = (message) => Object.assign(new Error(message), { shown: true }); // message prêt à afficher
async function notifyFetch(sub) {
  const r = await send('push:get', { subscription: sub?.toJSON(), account: !!account.user });
  if (r.error) throw notifyError(r.error);
  return r;
}
/** sub : cet appareil, à inscrire ; sans lui (compte seulement), seuls les choix du compte changent. */
async function notifySave(sub, prefs) {
  const r = await send('push:save', { subscription: sub?.toJSON(), prefs, previous: store.get(NOTIFY_KEY)?.endpoint, account: !!account.user });
  if (r.error) throw notifyError(r.error);
  notifyRemember(sub, r.prefs ?? NO_PREFS, sub ? r.here : notify.here);
}
/**
 * Remet l'écran, l'appareil et le serveur d'accord : choix du compte changés ailleurs, adresse de l'appareil
 * changée, connexion, déconnexion. Au plus toutes les 30 s, sauf force.
 */
async function notifySync(force) {
  // Compte retenu sur l'appareil mais pas encore confirmé par le serveur : on attend (accountSync rappelle)
  if (!notify.key || notify.busy || (store.get(AUTH_KEY) && !account.ready)) return;
  if (!force && Date.now() - notify.at < 30_000) return;
  const signedIn = !!account.user;
  const saved = store.get(NOTIFY_KEY);
  if (!signedIn && !saved) return;
  notify.at = Date.now();
  // Cet appareil recevait déjà (en invité, ou pour le compte) : son inscription est entretenue
  const receiving = !!saved && (saved.account ? !!saved.here : hasChoices(saved.prefs));
  try {
    const sub = receiving && notifyAllowed() ? await notifySubscription() : null;
    if (!signedIn && saved.account) {
      // Déconnexion : un appareil activé garde les mêmes rappels, en invité ; sinon on oublie les choix du compte
      if (sub) await notifySave(sub, saved.prefs);
      else notifyForget();
    } else if (signedIn) {
      const r = await notifyFetch(sub);
      // Premier passage en compte : les choix de l'appareil servent au compte qui n'en a pas encore
      if (sub && !r.here) await notifySave(sub, r.prefs ?? saved.prefs);
      else notifyRemember(sub, r.prefs ?? NO_PREFS, r.here);
    } else if (sub) {
      const r = await notifyFetch(sub);
      if (!r.prefs) await notifySave(sub, saved.prefs);
      else notifyRemember(sub, r.prefs, r.here);
    }
    render();
    notifyOffer();
  } catch { notify.at = 0; }
}
/**
 * Popup « Activer les rappels sur cet appareil ? » : compte avec des rappels, appareil pas activé et pas bloqué
 * (sur iPhone, seulement dans l'app installée). Seulement sur l'accueil au repos : jamais par-dessus une partie,
 * une autre fenêtre, une invitation dans un salon ou une saisie. Montrée une fois, elle ne revient pas.
 */
function notifyOffer() {
  if (!notifyAway() || NOTIFY_IOS || Notification.permission === 'denied' || store.get(NOTIFY_ASKED_KEY)) return;
  if (displayPhase() !== 'home' || ui.sheet || proposeOpen() || urlCode() || document.activeElement?.matches('input, textarea')) return;
  store.set(NOTIFY_ASKED_KEY, true);
  openSheet('nfask');
}
/** Connexion, déconnexion, session expirée (session.js, actions.js). */
function notifyAccountChanged() {
  notify.at = 0;
  if (notify.key) notifySync(true);
  else loadLive(); // la réponse rappelle notifySync
}
/** Compte supprimé : plus rien sur cet appareil. */
async function notifyDrop() {
  notifyForget();
  if (!NOTIFY_OK) return;
  const reg = await navigator.serviceWorker.getRegistration();
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}
/** Appelé par loadLive() à chaque réponse du serveur. */
function notifyInfo(info) {
  notify.key = info.pushKey || null;
  notify.program = info.program || [];
  notifySync();
}
// Retour sur la page : les choix du compte ont pu changer sur un autre appareil
document.addEventListener('visibilitychange', () => { if (!document.hidden && account.user) notifySync(true); });

/** Les choix après avoir coché ou décoché « every » ou « format:<id> » (profil, programme). */
function notifyWith(prefs, value, on) {
  if (value === 'every') return { ...prefs, every: on };
  const id = value.slice('format:'.length);
  const split = prefs.every && !on; // décocher un créneau alors que « Tous les directs » est coché : les autres restent
  const formats = (split ? liveFormats().map((f) => f.id) : prefs.formats).filter((x) => x !== id);
  return { every: split ? false : prefs.every, formats: on ? [...formats, id] : formats, slots: prefs.slots };
}
/**
 * Change mes choix (change : anciens choix → nouveaux). adds : on demande à être prévenu, il faut donc
 * l'autorisation de cet appareil (avec un compte, on peut quand même régler ses choix sans elle).
 * done : appelé dès que le changement est affiché (ex. fermer la mini-feuille).
 */
async function notifyChange(change, { adds = true, done } = {}) {
  if (notify.busy) return false;
  const signedIn = !!account.user;
  // notifyAsk en premier : le navigateur n'accepte la demande que pendant le geste
  const allowed = adds ? (await notifyAsk()) === 'granted' : notifyAllowed();
  if (adds && !allowed) store.set(NOTIFY_ASKED_KEY, true); // refusé ici : pas de popup ensuite
  if (!signedIn && !allowed) return render();
  const before = notify.prefs;
  notify.prefs = change(before); // affiché tout de suite, annulé si l'enregistrement échoue
  notify.busy = true;
  if (done) done(); else render();
  let ok = false;
  try {
    const sub = allowed && (!signedIn || adds || notify.here) ? await notifySubscription() : null;
    // Compte : on repart de la dernière version, les choix ont pu changer sur un autre appareil
    const prefs = signedIn ? change((await notifyFetch()).prefs ?? NO_PREFS) : notify.prefs;
    await notifySave(sub, prefs);
    ok = !!sub;
  } catch (err) {
    notify.prefs = before;
    toast(err.shown ? err.message : 'Ton navigateur n’a pas pu activer les notifications');
  }
  notify.busy = false;
  render();
  return ok;
}
/** Une coche du profil ou une cloche du programme. */
actions.notifyset = (btn) => {
  const on = btn.dataset.on === '1';
  notifyChange((p) => notifyWith(p, btn.dataset.value, on), { adds: on });
};
/** « Activer sur cet appareil » : il reçoit ensuite les mêmes notifications que mes autres appareils. */
actions.notifyhere = async () => {
  if (await notifyChange((p) => p)) toast('Cet appareil recevra tes notifications');
};
/** « Activer » de la popup. Refus dans le navigateur : elle reste et explique comment revenir dessus. */
actions.notifyyes = async () => {
  if ((await notifyAsk()) !== 'granted') return render();
  if (ui.sheet === 'nfask') closeSheet();
  actions.notifyhere();
};
actions.notifyoff = async () => {
  if (notify.busy) return;
  notify.busy = true;
  try {
    const sub = await notifySubscription();
    const r = await send('push:off', { subscription: sub.toJSON() });
    if (r.error) throw notifyError(r.error);
    await sub.unsubscribe();
    notifyRemember(null, notify.prefs, false);
    store.set(NOTIFY_ASKED_KEY, true); // choix explicite : pas de popup ensuite
    toast('Cet appareil ne recevra plus de notification');
  } catch (err) {
    toast(err.shown ? err.message : 'Impossible de désactiver pour le moment');
  }
  notify.busy = false;
  render();
};
/**
 * Les trois choix d'une cloche s'emboîtent (ce direct, tout son créneau, tous les directs) : en prendre un
 * remplace les autres pour ce direct. level null : ne plus être prévenu.
 */
function bellPrefs(prefs, s, level) {
  const p = { every: level === 'every', formats: prefs.formats.filter((f) => f !== s.format), slots: prefs.slots.filter((x) => x !== s.id) };
  if (level === 'format') p.formats.push(s.format);
  if (level === 'slot') p.slots.push(s.id);
  return p;
}
/** Le direct de la mini-feuille ouverte. */
const bellSlot = () => [...(live.info?.today ?? []), ...(live.info?.upcoming ?? [])].find((x) => x.id === notify.slot);
/** Un des boutons de la mini-feuille : appliqué tout de suite, la feuille se ferme. Retoucher le choix actif le retire. */
actions.notifybell = (btn) => {
  const s = bellSlot();
  if (!s) return;
  const level = btn.getAttribute('aria-pressed') === 'true' ? null : btn.dataset.value;
  notifyChange((p) => bellPrefs(p, s, level), { adds: !!level, done: closeSheet });
};

// ---- affichage
/** Cloche d'une tuile de direct (accueil). */
function bellButton(s) {
  if (!notifyShown()) return '';
  const on = notifyCovers(s);
  const away = on && notifyAway();
  return `<button class="l-bell ${on ? 'on' : ''} ${away ? 'away' : ''}" data-action="bell" data-value="${s.id}" aria-pressed="${on}" aria-label="Me prévenir : ${esc(s.name)}, ${liveTime(s.startsAt)}${away ? ' (actif sur ton compte, pas sur cet appareil)' : ''}">${ico('bell')}</button>`;
}
actions.bell = (btn) => {
  notify.slot = btn.dataset.value;
  // Des choix déjà faits sur le compte : la feuille propose « Activer sur cet appareil » avant toute demande
  if (!account.user || !hasChoices(notify.prefs)) notifyAsk();
  openSheet('bell');
  if (account.user) notifySync(true);
};
/** Pourquoi on ne peut rien cocher (iPhone hors app, notifications bloquées, navigateur sans support), sinon ''. */
function notifyBlocked() {
  if (NOTIFY_IOS) {
    return `<p class="sh-note">Sur iPhone, les notifications marchent seulement avec l’app installée sur l’écran d’accueil.</p>
      <button class="btn" data-action="sheet" data-value="getapp">${ico('download')} Installer l’app</button>`;
  }
  if (!NOTIFY_OK) return '<p class="sh-note">Ce navigateur ne permet pas les notifications.</p>';
  if (Notification.permission === 'denied') return `<p class="sh-note">Les notifications sont bloquées pour ${APP_NAME} sur cet appareil. Pour les réautoriser, ${notifyUnblock()}, puis reviens ici.</p>`;
  return '';
}
/** Où réautoriser des notifications bloquées, selon l'appareil. */
const notifyUnblock = () => (IOS ? `ouvre Réglages › Notifications › ${APP_NAME}`
  : STANDALONE && TOUCH ? `fais un appui long sur l’icône ${APP_NAME} et ouvre « Infos sur l’appli » › Notifications`
  : `${STANDALONE ? `ouvre ${APP_NAME} dans ton navigateur, ` : ''}touche l’icône à gauche de l’adresse du site et autorise « Notifications »`);
/**
 * Avec un compte : dit que cet appareil ne reçoit pas les rappels du compte, avec pourquoi (bloqué, iPhone…)
 * ou le bouton pour l'activer. main : le bouton est l'action principale de l'écran.
 */
function notifyDevice(main, label = 'Activer sur cet appareil') {
  if (!account.user) return '';
  const away = hasChoices(notify.prefs) && !notifyHere();
  const status = away ? '<p class="sh-note nf-status">Actif sur ton compte, pas sur cet appareil.</p>' : '';
  const blocked = notifyBlocked();
  const act = blocked || (away ? `<button class="btn ${main ? 'primary' : ''} nf-back" data-action="notifyhere">${ico('bell')} ${label}</button>` : '');
  return status || act ? `<div class="nf-device ${away && !blocked ? 'nf-act' : ''}">${status}${act}</div>` : '';
}
/** Popup proposée par notifyOffer ; si le navigateur vient de bloquer, elle explique comment revenir dessus. */
function notifyAskBody() {
  const blocked = notifyBlocked();
  if (blocked) return `${blocked}<button class="btn nf-back" data-action="sheetclose">Compris</button>`;
  return `<p class="sh-note">Tes rappels des quiz en direct sont actifs sur ton compte, mais cet appareil ne te préviendra pas tant qu’il n’est pas activé.</p>
    <button class="btn primary nf-back" data-action="notifyyes">${ico('bell')} Activer</button>
    <button class="btn nf-back" data-action="sheetclose">Plus tard</button>
    <p class="sh-note small">Cette question ne reviendra pas : tu peux activer cet appareil quand tu veux, depuis une cloche ou ton profil.</p>`;
}
/** Une ligne à cocher (toute la ligne se touche). mark : 'check' (case) ou 'bell' (cloche) ; more : HTML en plus. */
function notifyRow(value, on, title, sub, mark = 'check', more = '') {
  return `<button class="nf-row" role="checkbox" aria-checked="${on}" data-key="nf:${value}" data-action="notifyset" data-value="${value}" data-on="${on ? 0 : 1}">
    <span class="nf-txt"><b>${esc(title)}</b><small>${esc(sub)}</small>${more}</span>
    <span class="nf-mark nf-${mark}" aria-hidden="true">${mark === 'bell' ? ico('bell') : on ? ico('check') : ''}</span></button>`;
}
const capital = (text) => text.replace(/^./, (c) => c.toUpperCase());
const everyRow = (mark) => notifyRow('every', notifyPrefs().every, 'Tous les directs', 'Chaque jour, finale comprise', mark);
const formatRows = () => liveFormats().map((f) => {
  const p = notifyPrefs();
  return notifyRow(`format:${f.id}`, p.every || p.formats.includes(f.id), f.name, capital(f.when));
}).join('');
/** Mini-feuille d'une cloche : un bouton par choix (ce direct, tout son créneau, tous les directs). */
function bellBody() {
  if (!live.info) { loadLive(); return '<p class="muted">Chargement…</p>'; }
  const s = bellSlot();
  if (!s) return '<p class="muted">Ce direct est passé.</p>';
  const back = '<button class="btn nf-back" data-action="sheetclose">Retour</button>';
  const blocked = notifyBlocked();
  if (blocked && !account.user) return blocked + back;
  const p = notifyPrefs();
  const f = liveFormats().find((x) => x.id === s.format);
  const level = p.every ? 'every' : p.formats.includes(s.format) ? 'format' : p.slots.includes(s.id) ? 'slot' : null;
  const choice = (value, title, sub) => {
    const on = level === value;
    return `<button class="nf-row nf-pick" aria-pressed="${on}" data-key="nf:${value}" data-action="notifybell" data-value="${value}">
      <span class="nf-txt"><b>${esc(title)}</b><small>${esc(on ? 'Activé : touche pour retirer' : sub)}</small></span>
      <span class="nf-mark" aria-hidden="true">${on ? ico('check') : ''}</span></button>`;
  };
  return `<p class="sh-note">Une notification quand la salle d’attente ouvre, ${Math.round((s.startsAt - s.opensAt) / 60000)} min avant le départ.</p>
    ${notifyDevice(true)}
    <div class="nf-list">
      ${s.status === 'upcoming' ? choice('slot', 'Ce direct seulement', `${s.name}, ${liveDay(s)} à ${liveTime(s.startsAt)}`) : ''}
      ${f ? choice('format', ALL_OF[f.id] || `Tous les « ${f.name} »`, capital(f.when)) : ''}
      ${choice('every', 'Tous les directs', 'Chaque jour, finale comprise')}
    </div>
    ${back}`;
}
/** Programme des directs : chacun expliqué (surtout sa difficulté), avec sa cloche. */
function programBody() {
  if (!live.info) loadLive();
  else notifySync();
  const blocked = notify.key ? notifyBlocked() : '';
  const bells = !!notify.key && (!!account.user || (notifyShown() && !blocked));
  const p = notifyPrefs();
  const rows = liveFormats().map((f) => {
    const sub = `${capital(f.when)} · ${f.rounds} questions`;
    const level = `<small class="nf-level"><b>${DIFFICULTY[f.diff] || ''}</b> : ${esc(f.about)}</small>`;
    return bells ? notifyRow(`format:${f.id}`, p.every || p.formats.includes(f.id), f.name, sub, 'bell', level)
      : `<div class="nf-row"><span class="nf-txt"><b>${esc(f.name)}</b><small>${esc(sub)}</small>${level}</span></div>`;
  }).join('');
  return `<p class="sh-note nf-intro">Les mêmes questions pour tout le monde, au même instant.${bells ? ' Touche un direct pour être prévenu.' : ''}</p>
    ${bells ? notifyDevice(false, 'Activer ici') : ''}
    <div class="nf-list nf-program ${notifyAway() ? 'away' : ''}">${rows}${bells ? everyRow('bell') : ''}</div>
    ${bells ? '' : blocked}`;
}
/** Section « Notifications » du profil : une coche par créneau. */
function notifySection() {
  if (!live.info) loadLive();
  else notifySync();
  if (!notify.key) return '';
  const blocked = notifyBlocked();
  const signedIn = !!account.user;
  const where = signedIn ? ' Tes choix suivent ton compte sur tous tes appareils.'
    : ` Réglage propre à cet appareil${account.cfg?.enabled ? ' : connecte-toi pour le retrouver sur les autres' : ''}.`;
  const here = signedIn && notifyHere()
    ? '<p class="sh-note small">Activées sur cet appareil. <button class="link" type="button" data-action="notifyoff">Désactiver ici</button></p>' : '';
  return `<div class="acc pf-notif">
    <h3>Notifications</h3>
    <p class="sh-note small">Un message par direct coché, à l’ouverture de sa salle d’attente. Rien d’autre.${where}</p>
    ${notifyDevice(false)}${here}
    ${blocked && !signedIn ? blocked : `<div class="nf-list">${everyRow('check')}${formatRows()}</div>`}
  </div>`;
}

// ---- notification touchée
/** Ouvre le direct annoncé ; dans un salon, on ne coupe pas la partie. */
function openDirect(id) {
  if (state) return toast('Un direct ouvre sa salle d’attente : retrouve-le sur l’accueil');
  homeUi.tab = 'comp';
  live.focus = id || null;
  live.info = null;
  openSheet('live');
}
if (NOTIFY_OK) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'quizparty:direct') openDirect(e.data.slot); });
