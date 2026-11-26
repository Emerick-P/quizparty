// QuizParty — Défis entre potes.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  défis entre potes
// Un joueur connecté fige une série de questions et partage un lien (/?c=CODE). Chacun le joue quand il veut,
// une seule fois, avec un classement commun (invités compris). La partie elle-même réutilise l'affichage du
// Défi du jour (state.daily, avec state.daily.challenge en plus).
const DEVICE_KEY = 'quizparty:device'; // identifiant de cet appareil (invité : une tentative par appareil)
const POTES_KEY = 'quizparty:defis'; // codes des défis ouverts sur cet appareil (« Mes défis » d'un invité)
const potes = { opts: null, list: null, info: null, code: null, form: null, loading: false, busy: false };

function potesDevice() {
  let id = store.get(DEVICE_KEY);
  if (typeof id !== 'string' || !/^[\w-]{16,64}$/.test(id)) {
    id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    store.set(DEVICE_KEY, id);
  }
  return id;
}
function potesRemember(code) {
  const list = (store.get(POTES_KEY) || []).filter((c) => c !== code);
  store.set(POTES_KEY, [code, ...list].slice(0, 30));
}
const potesLink = (code) => `${location.origin}/?c=${code}`;
function potesLeft(at) {
  const s = Math.max(0, Math.round((at - now()) / 1000));
  if (s >= 86400) { const d = Math.round(s / 86400); return `${d} jour${d > 1 ? 's' : ''}`; }
  return untilNext(at);
}
const potesSettings = (c) => `${esc(c.modeName)} · ${c.rounds} questions · ${c.duration} s`;

async function loadPotes() {
  if (potes.loading) return;
  potes.loading = true;
  const [o, l] = await Promise.all([
    potes.opts ? { ok: true } : send('challenge:options'),
    send('challenge:list', { device: potesDevice(), codes: store.get(POTES_KEY) || [] }),
  ]);
  potes.loading = false;
  if (!potes.opts && !o.error) {
    potes.opts = o;
    potes.form ??= { ...o.defaults };
  }
  potes.list = l.error ? [] : l.list;
  render();
}
async function loadPote() {
  if (potes.loading || !potes.code) return;
  potes.loading = true;
  const r = await send('challenge:info', { code: potes.code, device: potesDevice() });
  potes.loading = false;
  potes.info = r;
  if (!r.error) potesRemember(r.challenge.id);
  render();
}

function potesTile() {
  return `<button class="h-tile" data-action="defis"><span class="t-ico">${ico('swords')}</span><b>Défis entre potes</b><small>Crée un défi, partage le lien, classement commun</small></button>`;
}

/** Page « Défis entre potes » : créer un défi, puis la liste de mes défis (créés ou joués). */
function potesBody() {
  if (!potes.list) { loadPotes(); return '<p class="muted">Chargement…</p>'; }
  const o = potes.opts, f = potes.form;
  const canCreate = !account.cfg?.enabled || !!account.user;
  const seg = (key, values, suffix) => `<div class="seg">${values.map((v) =>
    `<button class="${f[key] === v ? 'sel' : ''}" data-action="defiset" data-key="${key}" data-value="${v}">${v}${suffix}</button>`).join('')}</div>`;
  const create = !o ? '' : canCreate ? `
    <section class="p-new">
      <div class="p-modes">${[...o.modes].sort((a, b) => (b.id === 'mix') - (a.id === 'mix')).map((m) => `<button class="mix-part ${f.mode === m.id ? 'sel' : ''}" data-action="defiset" data-key="mode" data-value="${m.id}" aria-pressed="${f.mode === m.id}"><span aria-hidden="true">${modeArt(m.id)[0]}</span> ${esc(m.name)}</button>`).join('')}</div>
      <div class="opt p-q"><span>Questions</span>${seg('rounds', o.rounds, '')}</div>
      <div class="opt p-t"><span>Chrono</span>${seg('duration', o.durations, ' s')}</div>
      <button class="btn primary big" data-action="deficreate" ${potes.busy ? 'disabled' : ''}>Créer le défi</button>
      <p class="opt-hint">Tes potes ont ${o.days} jours pour le jouer, une seule fois chacun. Les mêmes questions pour tout le monde.</p>
    </section>`
    : `<p class="sh-note"><button class="link" data-action="sheet" data-value="name">Connecte-toi</button> pour créer un défi. Sans compte, tu peux jouer ceux qu’on t’envoie.</p>`;
  const list = potes.list;
  return `<div class="d-sheet p-sheet">
    ${create}
    <div class="d-col"><h3>Mes défis</h3>
    ${list.length ? `<ul class="list p-list">${list.map((x) => {
      const closed = now() >= x.endsAt;
      const status = x.played ? `${fmtPts(x.played.score)} pts${x.rank ? ` · ${x.rank}<sup>e</sup>/${x.players}` : ''}` : closed ? 'Terminé' : 'À jouer';
      return `<li><button class="p-row" data-action="defiopen" data-value="${x.id}">
        <span class="grow"><b>${x.mine ? 'Mon défi' : `Défi de ${esc(x.by)}`}</b><small>${potesSettings(x)} · ${closed ? 'clos' : `encore ${potesLeft(x.endsAt)}`}</small></span>
        <span class="p-st ${x.played ? '' : closed ? 'off' : 'go'}">${status}</span></button></li>`;
    }).join('')}</ul>` : '<p class="muted d-empty">Aucun défi pour l’instant. Crée le premier, ou ouvre le lien qu’un pote t’a envoyé.</p>'}</div>
  </div>`;
}

/** Page d'un défi (ouverte par son lien) : réglages, bouton Jouer, ou mon résultat et le classement. */
function poteBody() {
  const r = potes.info;
  if (!r) { loadPote(); return '<p class="muted">Chargement…</p>'; }
  if (r.error) return `<div class="d-sheet"><p class="muted d-empty">${esc(r.error)}. Le lien est peut-être incomplet.</p><button class="btn" data-action="defis">Voir mes défis</button></div>`;
  const c = r.challenge;
  const share = !r.closed ? `<button class="btn ${r.played ? '' : r.mine ? 'primary' : ''}" data-action="defishare">${ico('share')} ${r.mine && !r.played ? 'Envoyer le lien à mes potes' : 'Partager le défi'}</button>` : '';
  const head = `<div class="d-intro p-intro">
      <span class="d-num">${r.mine ? 'Ton défi' : `Défi de ${esc(c.by)}`}</span>
      <ul class="d-rules">
        <li><b>${c.rounds}</b> questions · ${esc(c.modeName)}</li>
        <li><b>${c.duration} s</b> par question, plus tu réponds vite, plus tu marques</li>
        <li>${r.closed ? '<b>Défi terminé</b> : voici le classement final' : `<b>Une seule tentative</b> · encore ${potesLeft(c.endsAt)}`}</li>
      </ul>
      <span class="p-count">${r.players} joueur${r.players > 1 ? 's' : ''} pour l’instant</span>
    </div>`;
  if (r.played) {
    return `<div class="d-sheet">
      <div class="d-result">
        <small>${r.mine ? 'Ton défi' : `Défi de ${esc(c.by)}`} · ${r.played.correct}/${r.played.rounds} trouvées</small>
        <b>${fmtPts(r.played.score)} <span>pts</span></b>
        ${cellsHtml(gridCells(r.played.grid), 'big')}
      </div>
      ${share}
      <div class="d-col"><h3>Classement du défi</h3>${dailyBoard(r.leaderboard, r.me, 8)}</div>
    </div>`;
  }
  if (r.closed) return `<div class="d-sheet">${head}<div class="d-col"><h3>Classement final</h3>${dailyBoard(r.leaderboard, r.me, 8)}</div></div>`;
  return `<div class="d-sheet p-play">
    ${head}
    ${account.user || !account.cfg?.enabled ? '' : '<p class="sh-note">Tu joues en invité : ton pseudo apparaîtra au classement avec la mention « invité ».</p>'}
    <button class="btn primary big" data-action="defiplay">C’est parti !</button>
    ${share}
  </div>`;
}

/** Fin d'une partie de défi : mon score, partage, classement du défi. */
function potesEnd() {
  const d = state.daily, c = d.challenge;
  const me = state.players.find((p) => p.id === state.you);
  const text = `QuizParty · Défi de ${c.by}\n${d.grid}\n${fmtPts(me?.score)} pts\nÀ toi : ${potesLink(c.id)}`;
  return `
    <main class="screen d-end">
      <div class="d-result">
        <small>Défi de ${esc(c.by)} · ${d.correct}/${d.rounds} trouvées</small>
        <b>${fmtPts(me?.score)} <span>pts</span></b>
        ${cellsHtml(d.cells.map((x) => CELL_CLASS[x] || 'ko'), 'big')}
      </div>
      <button class="btn primary" data-action="dailyshare" data-value="${esc(text)}">${ico('share')} Partager mon résultat</button>
      <section class="card d-card">
        <h2>Classement du défi</h2>
        ${d.leaderboard ? dailyBoard(d.leaderboard, d.me) : '<p class="muted">Chargement…</p>'}
      </section>
      <p class="muted d-next">Défi ouvert encore ${potesLeft(c.endsAt)}</p>
      <button class="btn" data-action="defihome">Retour au défi</button>
    </main>`;
}

actions.defis = () => {
  potes.list = null;
  openSheet('defis');
};
actions.defiset = (btn) => {
  const { key, value } = btn.dataset;
  potes.form[key] = key === 'mode' ? value : Number(value);
  render();
};
actions.deficreate = async () => {
  if (potes.busy) return;
  potes.busy = true;
  render();
  const r = await send('challenge:create', { ...potes.form, name: store.get(NAME_KEY) || '' });
  potes.busy = false;
  if (r.error) { render(); return toast(r.error); }
  potesRemember(r.challenge.id);
  potes.list = null;
  actions.defiopen({ dataset: { value: r.challenge.id } });
};
actions.defiopen = (btn) => {
  potes.code = btn.dataset.value;
  potes.info = null;
  openSheet('defi');
};
actions.defiplay = async () => {
  const name = store.get(NAME_KEY) || account.user?.nickname || account.user?.name;
  if (!name) { toast('Choisis d’abord ton pseudo'); return openSheet('name'); }
  unlockAudio();
  const res = await send('challenge:start', { code: potes.code, name, device: potesDevice() });
  if (res.already) { potes.info = null; render(); return toast('Tu as déjà joué ce défi'); }
  if (res.error) return toast(res.error);
  ui.sheet = null;
  enterRoom(res);
};
actions.defishare = () => {
  const c = potes.info?.challenge;
  if (!c) return;
  shareDaily(`${c.by} te lance un défi sur QuizParty : ${c.rounds} questions (${c.modeName}). Une seule tentative, classement commun !\n${potesLink(c.id)}`);
};
actions.defihome = async () => {
  const code = state?.daily?.challenge?.id;
  await send('room:leave');
  leaveLocal();
  if (code) actions.defiopen({ dataset: { value: code } });
};
