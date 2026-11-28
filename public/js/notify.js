// QuizParty — Notifications des directs (cloches, profil) et programme de la semaine.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  notifications des directs
// Une seule notification par direct, à l'ouverture de la salle d'attente. Les choix sont ceux de l'appareil
// (invités compris) ; le serveur les retrouve grâce à l'abonnement du navigateur (server/push.js).
// L'autorisation du navigateur n'est demandée qu'au premier appui sur une cloche ou une coche.
const NOTIFY_KEY = 'quizparty:notify'; // { endpoint, prefs }
const NO_PREFS = { every: false, formats: [], slots: [] };
// key : clé publique du serveur (absente = notifications désactivées) ; program : créneaux de la semaine
const notify = { key: null, program: [], prefs: store.get(NOTIFY_KEY)?.prefs ?? NO_PREFS, slot: null, busy: false, synced: false };
const NOTIFY_OK = !SCREEN && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const NOTIFY_IOS = IOS && !STANDALONE; // iPhone : seulement dans l'app installée sur l'écran d'accueil
/** Cloches affichées : le serveur sait envoyer et l'appareil peut recevoir (ou iPhone, pour dire comment). */
const notifyShown = () => !!notify.key && (NOTIFY_OK || NOTIFY_IOS);
const notifyAllowed = () => NOTIFY_OK && !NOTIFY_IOS && Notification.permission === 'granted';
/** Mes choix tels qu'ils comptent : sans l'autorisation du navigateur, rien n'est actif. */
const notifyPrefs = () => (notifyAllowed() ? notify.prefs : NO_PREFS);
const notifyCovers = (s) => { const p = notifyPrefs(); return p.every || p.formats.includes(s.format) || p.slots.includes(s.id); };

// ---- programme de la semaine
const WEEK_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DAYS_TEXT = { '0123456': 'tous les jours', 12345: 'en semaine', 123456: 'du lundi au samedi', '06': 'samedi et dimanche', 0: 'le dimanche', 6: 'le samedi' };
const hourText = (hm) => hm.replace(/^0/, '').replace(':00', ' h').replace(':', ' h ');
const daysText = (days) => DAYS_TEXT[[...days].sort().join('')] || days.map((d) => WEEK_DAYS[d]).join(', ');
const ALL_OF = { midi: 'Toutes les Pause déj', brunch: 'Tous les Brunch', soir: 'Tous les Apéro', nuit: 'Tous les Hardcore', finale: 'Toutes les finales' };
/** Un créneau par format : { id, name, tagline, when: « en semaine à 12 h 45 » }. */
function liveFormats() {
  const out = new Map();
  for (const e of notify.program) {
    const when = `${daysText(e.days)} à ${hourText(e.time)}`;
    const f = out.get(e.id);
    if (f) f.when += ` · ${when}`;
    else out.set(e.id, { id: e.id, name: e.name, tagline: e.tagline, when });
  }
  return [...out.values()];
}
/** Écran bas (petit téléphone, paysage) : un simple lien à côté du titre, sans ligne en plus. */
function programLink() {
  if (!notify.program.length) return '';
  return `<button class="l-week-short" data-action="sheet" data-value="week">${live.info?.weekend ? 'En semaine, ça change' : 'Le week-end change'} ›</button>`;
}
/** Sous les tuiles : ce qui change entre la semaine et le week-end (le détail est dans le programme). */
function programTeaser() {
  const weekend = live.info?.weekend;
  const other = notify.program.filter((e) => (weekend ? e.days.includes(1) : e.days.every((d) => d === 0 || d === 6)));
  const names = other.map((e) => {
    const name = e.name.replace(/^La /, 'la ');
    const day = !weekend && e.days.length === 1 ? ` ${WEEK_DAYS[e.days[0]]}` : '';
    return `${name}${day} à ${hourText(e.time)}`;
  }).join(', ');
  if (!notify.program.length) return '';
  const text = !names ? 'Les horaires de la semaine' : weekend ? `En semaine : ${names}` : `Le week-end change : ${names}`;
  return `<button class="l-week" data-action="sheet" data-value="week">${ico('calendar')}<span>${esc(text)}</span><b>Programme ›</b></button>`;
}

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
async function notifySave(sub, prefs) {
  const r = await send('push:save', { subscription: sub.toJSON(), prefs, previous: store.get(NOTIFY_KEY)?.endpoint });
  if (r.error) throw Object.assign(new Error(r.error), { shown: true });
  notify.prefs = r.prefs ?? NO_PREFS;
  store.set(NOTIFY_KEY, { endpoint: sub.endpoint, prefs: notify.prefs });
}
/** Au chargement : remet le serveur d'accord avec l'appareil (adresse changée, ligne perdue). */
async function notifySync() {
  const saved = store.get(NOTIFY_KEY);
  if (notify.synced || !saved || !notify.key || !notifyAllowed()) return;
  notify.synced = true;
  try {
    const sub = await notifySubscription();
    const r = await send('push:get', { subscription: sub.toJSON() });
    if (r.error) throw new Error(r.error);
    const p = saved.prefs;
    if (!r.prefs && (p?.every || p?.formats?.length || p?.slots?.length)) await notifySave(sub, p);
    else {
      notify.prefs = r.prefs ?? NO_PREFS;
      store.set(NOTIFY_KEY, { endpoint: sub.endpoint, prefs: notify.prefs });
    }
    render();
  } catch { notify.synced = false; }
}
/** Appelé par loadLive() à chaque réponse du serveur. */
function notifyInfo(info) {
  notify.key = info.pushKey || null;
  notify.program = info.program || [];
  notifySync();
}

/** Les choix après avoir coché ou décoché « every » ou « format:<id> » (profil, programme). */
function notifyWith(prefs, value, on) {
  if (value === 'every') return { ...prefs, every: on };
  const id = value.slice('format:'.length);
  const split = prefs.every && !on; // décocher un créneau alors que « Tous les directs » est coché : les autres restent
  const formats = (split ? liveFormats().map((f) => f.id) : prefs.formats).filter((x) => x !== id);
  return { every: split ? false : prefs.every, formats: on ? [...formats, id] : formats, slots: prefs.slots };
}
/**
 * Change mes choix (change : anciens choix → nouveaux), après l'autorisation du navigateur.
 * done : appelé dès que le changement est affiché (ex. fermer la mini-feuille).
 */
async function notifyChange(change, done) {
  if (notify.busy) return;
  if ((await notifyAsk()) !== 'granted') return render();
  const before = notify.prefs;
  notify.prefs = change(before); // affiché tout de suite, annulé si l'enregistrement échoue
  notify.busy = true;
  if (done) done(); else render();
  try {
    await notifySave(await notifySubscription(), notify.prefs);
  } catch (err) {
    notify.prefs = before;
    toast(err.shown ? err.message : 'Ton navigateur n’a pas pu activer les notifications');
  }
  notify.busy = false;
  render();
}
/** Une coche du profil ou une cloche du programme. */
actions.notifyset = (btn) => notifyChange((p) => notifyWith(p, btn.dataset.value, btn.dataset.on === '1'));
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
  notifyChange((p) => bellPrefs(p, s, level), closeSheet);
};

// ---- affichage
/** Cloche d'une tuile de direct (accueil). */
function bellButton(s) {
  if (!notifyShown()) return '';
  const on = notifyCovers(s);
  return `<button class="l-bell ${on ? 'on' : ''}" data-action="bell" data-value="${s.id}" aria-pressed="${on}" aria-label="Me prévenir : ${esc(s.name)}, ${liveTime(s.startsAt)}">${ico('bell')}</button>`;
}
actions.bell = (btn) => {
  notify.slot = btn.dataset.value;
  notifyAsk();
  openSheet('bell');
};
/** Pourquoi on ne peut rien cocher (iPhone hors app, notifications bloquées, navigateur sans support), sinon ''. */
function notifyBlocked() {
  if (NOTIFY_IOS) {
    return `<p class="sh-note">Sur iPhone, les notifications marchent seulement avec l’app installée sur l’écran d’accueil.</p>
      <button class="btn" data-action="sheet" data-value="getapp">${ico('download')} Installer l’app</button>`;
  }
  if (!NOTIFY_OK) return '<p class="sh-note">Ce navigateur ne permet pas les notifications.</p>';
  if (Notification.permission === 'denied') return '<p class="sh-note">Les notifications sont bloquées pour QuizParty : autorise-les dans les réglages de ton navigateur, puis reviens ici.</p>';
  return '';
}
/** Une ligne à cocher (toute la ligne se touche). mark : 'check' (case) ou 'bell' (cloche). */
function notifyRow(value, on, title, sub, mark = 'check') {
  return `<button class="nf-row" role="checkbox" aria-checked="${on}" data-key="nf:${value}" data-action="notifyset" data-value="${value}" data-on="${on ? 0 : 1}">
    <span class="nf-txt"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
    <span class="nf-mark nf-${mark}" aria-hidden="true">${mark === 'bell' ? ico('bell') : on ? ico('check') : ''}</span></button>`;
}
const capital = (text) => text.replace(/^./, (c) => c.toUpperCase());
const everyRow = (mark) => notifyRow('every', notifyPrefs().every, 'Tous les directs', 'En semaine et le week-end', mark);
const formatRows = (mark) => liveFormats().map((f) => {
  const p = notifyPrefs();
  return notifyRow(`format:${f.id}`, p.every || p.formats.includes(f.id), f.name, capital(f.when), mark);
}).join('');
/** Mini-feuille d'une cloche : un bouton par choix (ce direct, tout son créneau, tous les directs). */
function bellBody() {
  if (!live.info) { loadLive(); return '<p class="muted">Chargement…</p>'; }
  const s = bellSlot();
  if (!s) return '<p class="muted">Ce direct est passé.</p>';
  const back = '<button class="btn nf-back" data-action="sheetclose">Retour</button>';
  const blocked = notifyBlocked();
  if (blocked) return blocked + back;
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
    <div class="nf-list">
      ${s.status === 'upcoming' ? choice('slot', 'Ce direct seulement', `${s.name}, ${liveDay(s)} à ${liveTime(s.startsAt)}`) : ''}
      ${f ? choice('format', ALL_OF[f.id] || `Tous les « ${f.name} »`, capital(f.when)) : ''}
      ${choice('every', 'Tous les directs', 'En semaine et le week-end')}
    </div>
    ${back}`;
}
/** Programme de la semaine, avec une cloche par créneau (ceux du week-end compris). */
function programBody() {
  if (!live.info) loadLive();
  const blocked = notify.key ? notifyBlocked() : '';
  const bells = notifyShown() && !blocked;
  return `<p class="sh-note">Les mêmes questions pour tout le monde, au même instant. La salle d’attente ouvre quelques minutes avant.${bells ? ' Touche un créneau pour être prévenu.' : ''}</p>
    <div class="nf-list nf-program">${bells ? formatRows('bell') + everyRow('bell')
    : liveFormats().map((f) => `<div class="nf-row"><span class="nf-txt"><b>${esc(f.name)}</b><small>${esc(capital(f.when))}</small></span></div>`).join('')}</div>
    ${blocked}`;
}
/** Section « Notifications » du profil : une coche par créneau. */
function notifySection() {
  if (!live.info) loadLive();
  if (!notify.key) return '';
  const blocked = notifyBlocked();
  return `<div class="acc pf-notif">
    <h3>Notifications</h3>
    <p class="sh-note small">Un message par direct coché, à l’ouverture de sa salle d’attente. Rien d’autre. Réglage propre à cet appareil.</p>
    ${blocked || `<div class="nf-list">${everyRow('check')}${formatRows('check')}</div>`}
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
