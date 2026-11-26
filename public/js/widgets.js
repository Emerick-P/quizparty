// QuizParty — Morceaux d’écran partagés : pause, signalement, Steam, avatars, classements, liste des joueurs.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  vues
const isHost = () => state && state.hostId === state.you;

// =====================================================================  pause et retours de l'hôte
// L'hôte peut figer la partie (⚑ Signaler) pour noter un souci sur la question : réponse à accepter en plus,
// bonne réponse fausse, question à supprimer… Les retours sont enregistrés par le serveur (data/feedback.jsonl).
// Tout joueur peut signaler une erreur (sans pause : la partie continue). Accepter une réponse ou supprimer
// une question est réservé à l'admin (state.admin, décidé par le serveur).
const report = { type: null, pausedAt: null, open: false, roundId: null };
const REPORT_TYPES = [
  ['accept', 'Accepter une autre réponse', true],
  ['wrong', 'La bonne réponse est fausse', true],
  ['remove', 'Question à supprimer', true],
  ['other', 'Autre', true],
];
const PLAYER_TYPES = [
  ['wrong', 'Erreur dans la question ou la réponse'],
  ['other', 'Autre souci'],
];

function reportButton() {
  const n = state.round?.reported || 0;
  return `<button class="btn small ghost report-btn" data-action="pause" title="Mettre en pause et signaler un souci sur cette question">${ico('flag')} Signaler${n ? ` <span class="count">${n}</span>` : ''}</button>`;
}
/** Correction, joueur qui n'est pas l'hôte : son bouton ⚑ (sans pause). Pas pendant la question : pas de place perdue. */
const playerBar = (extra = '') => (state.phase === 'end' ? '' : `<div class="host-bar player-bar">${extra}<button class="btn small ghost report-btn" data-action="flag" title="Signaler une erreur sur cette question">${ico('flag')} Signaler</button></div>`);

/** Manche à réponse tapée : on peut demander d'accepter une autre écriture. */
function typedRound(r) {
  return r.kind === 'typed' || (GUESS_KINDS.includes(r.kind) && r.input === 'text');
}

/** Réponses ratées des joueurs (à la correction), proposées en un clic comme « réponse à accepter ». */
function missedAnswers() {
  const rv = state.phase === 'reveal' ? state.reveal : null;
  if (!rv) return [];
  const seen = new Map();
  const add = (t) => { const k = String(t ?? '').trim(); if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k); };
  for (const x of rv.results || []) if (!x.correct) { add(x.answerText); (x.guesses || []).forEach(add); }
  for (const x of rv.missed || []) (x.guesses || []).forEach(add);
  return [...seen.values()].slice(0, 12);
}

function pauseOverlay() {
  const p = state?.paused;
  const r = state?.round;
  if (!p || !r || !['countdown', 'question', 'reveal'].includes(state.phase)) return '';
  if (report.pausedAt !== p.at) { report.pausedAt = p.at; report.type = null; }
  if (!isHost()) {
    return `<div class="pause-overlay"><div class="pause-card card">
      <div class="pause-icon">${ico('pause')}</div>
      <h2>Pause</h2>
      <p class="muted">${esc(p.by || "L'hôte")} signale un souci sur cette question. Le chrono reprendra au même endroit pour tout le monde.</p>
    </div></div>`;
  }
  return reportForm(r, true);
}

/** Joueur (ou hôte sans pause) : panneau ⚑ par-dessus le jeu, la partie continue pour les autres. */
function flagOverlay() {
  const r = state?.round;
  if (!report.open) return '';
  if (!r || r.id !== report.roundId || !['countdown', 'question', 'reveal'].includes(state.phase) || state.paused) { report.open = false; return ''; }
  return reportForm(r, false);
}

function reportForm(r, paused) {
  const types = state.admin ? REPORT_TYPES.filter(([id]) => id !== 'accept' || typedRound(r)) : PLAYER_TYPES;
  if (report.type && !types.some(([id]) => id === report.type)) report.type = null;
  const picks = report.type === 'accept' ? missedAnswers() : [];
  return `<div class="pause-overlay ${paused ? '' : 'flag-overlay'}"><form class="pause-card card report" onsubmit="return false">
    <h2>${paused ? 'Partie en pause' : 'Signaler un souci'}</h2>
    <p class="muted small">${paused ? 'Le chrono est figé pour tout le monde. ' : 'La partie continue pendant ce temps. '}Qu'est-ce qui ne va pas avec cette question ?</p>
    <div class="report-types">${types.map(([id, label]) => `<button type="button" class="rchip ${report.type === id ? 'sel' : ''}" data-action="reportType" data-value="${id}">${label}</button>`).join('')}</div>
    <div class="report-fields" ${report.type ? '' : 'hidden'}>
      <label class="field" ${report.type === 'accept' ? '' : 'hidden'}>Réponse à accepter
        <input id="report-accept" maxlength="120" autocomplete="off" placeholder="Ex. : Zelda BOTW">
      </label>
      ${picks.length ? `<div class="report-picks"><span class="muted small">Réponses des joueurs :</span>${picks.map((t) => `<button type="button" class="rchip small" data-action="reportPick" data-value="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <label class="field">${report.type === 'other' ? 'Le souci' : 'Commentaire (facultatif)'}
        <textarea id="report-comment" maxlength="1000" rows="3" placeholder="${report.type === 'wrong' ? 'Ex. : la bonne réponse est…' : 'Précise si besoin'}"></textarea>
      </label>
    </div>
    ${paused ? `<div class="report-actions">
      <button type="button" class="btn primary" data-action="reportSend" data-resume="yes" ${report.type ? '' : 'disabled'}>Envoyer et reprendre</button>
      <button type="button" class="btn ghost small" data-action="reportSend" data-resume="no" ${report.type ? '' : 'disabled'}>Envoyer, rester en pause</button>
      <button type="button" class="link" data-action="resume">Reprendre sans signaler</button>
    </div>` : `<div class="report-actions">
      <button type="button" class="btn primary" data-action="reportSend" ${report.type ? '' : 'disabled'}>Envoyer</button>
      <button type="button" class="link" data-action="flagclose">Annuler</button>
    </div>`}
  </form></div>`;
}
// ---- Ta bande (profils Steam)

/** Image d'un jeu Steam (bannière de la boutique), cachée si elle ne charge pas. */
const gamePicture = (pic, done = false) => (pic.icon
  ? `<figure class="ach-pic"><img src="${esc(pic.url)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true"><figcaption>${esc(pic.caption || pic.alt || '')}</figcaption></figure>`
  : `<figure class="game-pic ${done ? 'done' : ''}"><img src="${esc(pic.url)}" alt="${esc(pic.alt || '')}" referrerpolicy="no-referrer" onerror="this.parentNode.hidden=true"></figure>`);

/** Bandeau « question sur X » : X répond sans marquer. */
function aboutLine(r) {
  if (!r.about) return '';
  const ids = r.about.ids || [r.about.id];
  return ids.includes(state.you)
    ? '<p class="about-line me">C\'est sur toi ! Réponds quand même, mais tu ne marques pas.</p>'
    : `<p class="about-line">Question sur <b>${esc(r.about.name)}</b> · ${ids.length > 1 ? 'ils ne marquent pas' : `${esc(r.about.name)} ne marque pas`}</p>`;
}

/** Fenêtre d'aide : où trouver son code ami Steam, et quels réglages de confidentialité ouvrir. */
let steamHelpOpen = false;
function steamHelpOverlay() {
  if (!steamHelpOpen || displayPhase() !== 'lobby') return '';
  return `<div class="pause-overlay" data-action="steamHelpClose"><div class="pause-card card steam-help" data-action="noop">
    <h2>Lier ton Steam</h2>
    <h3>1. Ton code de contact</h3>
    <p>Dans Steam sur PC : clique sur <b>ton pseudo</b> (en haut, à droite de Communauté) → <b>Contacts</b> → <b>Ajouter un contact</b>. Copie <b>Votre code de contact</b> et colle-le ici.</p>
    <div class="mock" aria-hidden="true">
      <div class="mock-bar"><span>Magasin</span><span>Bibliothèque</span><span>Communauté</span><span class="hl">Ton pseudo ▾</span></div>
      <div class="mock-menu"><span>Activité</span><span>Profil</span><span class="hl">Contacts</span><span>Groupes</span></div>
      <div class="mock-row"><span>Vos contacts</span><span class="mock-copy hl">Ajouter un contact</span></div>
      <div class="mock-panel"><small>Votre code de contact</small><b class="hl">12345678</b><span class="mock-copy">Copier</span></div>
    </div>
    <p class="small muted">Ça marche aussi avec l'adresse de ton profil : sur ta page de profil, clique sur l'adresse affichée sous le menu (steamcommunity.com/…), elle est copiée directement.</p>
    <h3>2. Profil public</h3>
    <p>Pour qu'on voie tes jeux : ouvre tes <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener">options de confidentialité</a> (ton pseudo → Profil → Modifier le profil → Options de confidentialité) et règle :</p>
    <div class="mock" aria-hidden="true">
      <div class="mock-row"><span>Visibilité de mon profil</span><b class="hl">tout le monde</b></div>
      <div class="mock-row"><span>Visibilité sur mes jeux</span><b class="hl">tout le monde</b></div>
      <div class="mock-row"><span>☐ Garder le temps total de jeu privé…</span><b class="hl">décoché</b></div>
      <div class="mock-row"><span>Liste de contacts <small>(facultatif)</small></span><b>tout le monde</b></div>
    </div>
    <p class="small muted">Seuls tes jeux et tes heures servent aux questions de la soirée. Rien n'est enregistré.</p>
    <button class="btn primary" type="button" data-action="steamHelpClose">Compris</button>
  </div></div>`;
}

/** Salon : lier son profil Steam (facultatif), pour le mode « Ta bande ». */
function steamCard() {
  const me = state.players.find((p) => p.id === state.you);
  const st = me?.steam;
  const linked = state.players.filter((p) => p.steam?.status === 'ok').length;
  let body;
  if (st?.status === 'loading') body = '<p class="muted">Chargement du profil…</p>';
  else if (st?.status === 'ok') {
    body = `<div class="steam-me">${st.avatar ? `<img src="${esc(st.avatar)}" alt="" referrerpolicy="no-referrer">` : ''}<span class="grow"><b>${esc(st.name)}</b><small class="muted">${st.games} jeu${st.games > 1 ? 'x' : ''}, dont ${st.played ?? 0} lancé${st.played > 1 ? 's' : ''}${st.achievements === 'loading' ? ' · succès en chargement…' : st.achievements != null ? ` · succès de ${st.achievements} jeu${st.achievements > 1 ? 'x' : ''}` : ''}</small></span><button class="link" data-action="steamUnlink">Délier</button></div>`;
    if ((st.played ?? 0) < 4) body += '<p class="steam-warn">Peu de jeux lancés sur ton compte : il y aura peu de questions sur toi. Les jeux prêtés par le partage familial Steam ne sont pas visibles.</p>';
  } else {
    const msg = st?.status === 'private' && st.hiddenTime
      ? `<p class="steam-warn">Ton temps de jeu est masqué. Dans tes <a href="${esc(st.privacyUrl)}" target="_blank" rel="noopener">options de confidentialité</a> Steam, décoche « Garder le temps total de jeu privé, même si mes détails de jeux sont publics », puis réessaie. <button type="button" class="link" data-action="steamHelp">Aide</button></p>`
      : st?.status === 'private'
      ? `<p class="steam-warn">Ton profil est privé : on ne voit pas tes jeux. Sur Steam, mets « Visibilité de mon profil » et « Visibilité sur mes jeux » sur <b>tout le monde</b> (<a href="${esc(st.privacyUrl)}" target="_blank" rel="noopener">options de confidentialité</a>), puis réessaie. <button type="button" class="link" data-action="steamHelp">Aide</button></p>`
      : st?.status === 'error' ? `<p class="steam-warn">${esc(st.message)}</p>` : '';
    body = `${msg}<form class="steam-form" data-form="steam">
        <input id="steam-input" autocomplete="off" placeholder="Code de contact ou adresse du profil" value="${esc(st?.input || store.get(STEAM_KEY) || '')}" enterkeyhint="send">
        <button class="btn small" type="submit">${st ? 'Réessayer' : 'Lier'}</button>
        <button class="btn small ghost help-btn" type="button" data-action="steamHelp" aria-label="Où trouver mon code de contact ?">?</button>
      </form>
      ${st?.status === 'private' ? '<button class="link" data-action="steamUnlink">Jouer sans mon profil</button>' : ''}`;
  }
  return `<section class="card steam-card">
    <h2>Ton Steam <span class="muted">facultatif</span></h2>
    ${body}
    <p class="opt-hint">Pour le jeu « Ta bande » : ${linked} joueur${linked > 1 ? 's' : ''} lié${linked > 1 ? 's' : ''}. Tes jeux et tes heures servent aux questions, rien n'est enregistré.</p>
  </section>`;
}

// ---- Images de profil (galerie maison, photo du compte, initiale) : voir server/avatars.js
const LOOK_KEY = 'quizparty:look'; // choix de l'appareil (invité), repris du compte une fois connecté
const looks = { emojis: [], hues: [] };
/** Photo choisie ('photo:discord', 'photo:google' ; 'photo' = ancien format, photo de la connexion en cours). */
function photoOf(look, u = account.user) {
  if (!u || !/^photo(:|$)/.test(look || '')) return null;
  const p = look.split(':')[1];
  return p ? u.photos?.[p] ?? null : u.avatar ?? null;
}
/** Chaîne enregistrée ('', 'photo:discord', 'e:i:j'…) → { emoji, hue } | { photo } | null. */
function lookView(look) {
  if (/^photo(:|$)/.test(look || '')) { const url = photoOf(look); return url ? { photo: url } : null; }
  const m = /^e:(\d+):(\d+)$/.exec(look || '');
  return m && looks.emojis[m[1]] ? { emoji: looks.emojis[m[1]], hue: looks.hues[m[2]] } : null;
}
/** Mon image : choix enregistré, sinon la photo du compte s'il y en a une. */
const myLookRaw = () => store.get(LOOK_KEY) ?? (account.user?.avatar && account.user.provider ? `photo:${account.user.provider}` : '');
const myLook = () => lookView(myLookRaw());
const lookOfName = (name) => state?.players?.find((p) => p.name === name)?.look ?? null;
const avatar = (name, look = lookOfName(name)) => (look?.photo
  ? `<span class="avatar ph"><img src="${esc(look.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
  : look?.emoji
    ? `<span class="avatar emo" style="--h:${look.hue}">${look.emoji}</span>`
    : `<span class="avatar" style="--h:${hue(name)}">${esc([...name][0]?.toUpperCase() || '?')}</span>`);
const myAvatar = (name) => avatar(name || '?', myLook());
// À score égal, le départage éventuel (mots croisés : premier à avoir trouvé son dernier mot)
const sortedByScore = () => [...state.players].sort((a, b) => b.score - a.score || (a.tiebreak ?? Infinity) - (b.tiebreak ?? Infinity));
const sortedByTotal = () => [...state.players].sort((a, b) => b.total - a.total || b.wins - a.wins);

/** Score global du salon : cumul des parties terminées depuis la dernière remise à zéro. */
function globalBoard() {
  const n = state.gamesPlayed || 0;
  if (!n) return '';
  const ranked = sortedByTotal();
  return `
      <section class="card global">
        <h2>Score global <span class="muted">${n} partie${n > 1 ? 's' : ''}</span></h2>
        <ul class="list">
          ${ranked.map((p, i) => `
            <li class="${p.id === state.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
              <span class="pos">${i > 0 && p.total === ranked[i - 1].total ? '' : i + 1}</span>${avatar(p.name)}
              <span class="grow">${esc(p.name)}</span>
              ${p.wins ? `<span class="wins" title="Parties gagnées">${ico('trophy')} ${p.wins}</span>` : ''}
              <span class="pts">${p.total}</span>
            </li>`).join('')}
        </ul>
        ${isHost() ? '<div class="card-foot"><button class="link danger" data-action="resetTotals">Remettre à zéro</button></div>' : ''}
      </section>`;
}

// Statut déjà affiché pour chaque joueur : l'animation ne se joue qu'au changement,
// pas à chaque nouvel état reçu (l'écran est entièrement redessiné à chaque fois).
const shownStatus = new Map();
const STATUS_BADGE = {
  answered: '<span class="badge" title="A répondu">✓</span>',
  found: '<span class="badge" title="A trouvé">✓</span>',
  missed: '<span class="badge" title="Plus d\'essais">✗</span>',
};

/** Joueurs pendant la question : qui a répondu, ou qui a trouvé quand on tape le nom. */
/** Saisie libre avec plusieurs essais (titre de jeu ou réponse du quiz). */
function guessBody(r, mine, placeholder) {
  if (mine !== null) {
    const ok = r.yourCorrect;
    const title = ok === false ? 'Plus d\'essais' : ok ? 'Trouvé !' : 'Vérification…';
    return `<div class="sent-box ${ok === false ? 'ko' : ''}">${title}<b>${esc(mine)}</b></div>`;
  }
  const left = r.tries - r.yourMisses;
  return `<form class="guess" data-form="guess">
      <input id="guess-input" maxlength="60" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(placeholder)}" enterkeyhint="send">
      <button class="btn primary" type="submit">OK</button>
    </form>
    <div class="tries" aria-label="${left} essais restants">${Array.from({ length: r.tries }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('')}<span class="muted">${left} essai${left > 1 ? 's' : ''}</span></div>
    <p class="recall-hint muted"><kbd>↑</kbd> pour reprendre ta saisie précédente</p>`;
}

function roster(r) {
  if (r.kind === 'crossword') return cwRoster(r);
  const multi = r.tries > 1;
  const done = state.players.filter((p) => p.status).length;
  const found = state.players.filter((p) => p.status === 'found').length;
  const count = multi
    ? `${found} / ${r.expected} ${found > 1 ? 'ont' : 'a'} trouvé`
    : `${r.answeredCount} / ${r.expected} ${r.answeredCount > 1 ? 'ont' : 'a'} répondu`;
  const chips = sortedByScore().filter((p) => p.connected || p.status).map((p) => {
    const key = `${r.id}:${p.id}`;
    const status = p.status || '';
    const prev = shownStatus.get(key);
    if (!prev || prev.status !== status) shownStatus.set(key, { status, at: Date.now() });
    const pop = status && Date.now() - shownStatus.get(key).at < 600 ? 'pop' : '';
    const misses = multi && !p.status && p.misses ? `<span class="misses" title="Essais ratés">${'✗'.repeat(p.misses)}</span>` : '';
    const label = !p.connected ? 'hors ligne'
      : status === 'found' ? 'a trouvé'
      : status === 'missed' ? 'plus d\'essais'
      : status === 'answered' ? 'a répondu'
      : p.misses && multi ? `${p.misses} essai${p.misses > 1 ? 's' : ''} raté${p.misses > 1 ? 's' : ''}`
      : 'réfléchit…';
    return `<li data-key="${p.id}" class="chip ${status || 'wait'} ${pop} ${p.id === state.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
        ${avatar(p.name)}<span class="cname">${esc(p.name)}<small class="clabel">${label}</small></span>${misses}${STATUS_BADGE[status] || ''}
      </li>`;
  });
  if (shownStatus.size > 200) shownStatus.clear();
  return `
      <aside class="roster" aria-label="Joueurs">
        <div class="roster-head muted"><span>${count}</span>${done >= r.expected ? '' : '<span class="dots">En attente</span>'}</div>
        <ul>${chips.join('')}</ul>
      </aside>`;
}

/** Joueurs pendant une grille : nombre de mots trouvés par chacun (jamais lesquels). */
function cwRoster(r) {
  const total = r.grid?.words.length ?? 10;
  const chips = sortedByScore().filter((p) => p.connected || p.progress?.found || p.progress?.grids).map((p) => {
    const pr = p.progress ?? { grids: 0, found: 0 };
    const key = `${r.id}:${p.id}`;
    const mark = `${pr.grids}:${pr.found}`;
    const prev = shownStatus.get(key);
    if (!prev || prev.status !== mark) shownStatus.set(key, { status: mark, at: Date.now() });
    const pop = Date.now() - shownStatus.get(key).at < 600 && (pr.grids || pr.found) ? 'pop' : '';
    const label = !p.connected ? 'hors ligne' : `${pr.grids} grille${pr.grids > 1 ? 's' : ''} · ${pr.found} / ${total} mots`;
    return `<li data-key="${p.id}" class="chip ${pr.grids ? 'found' : pr.found ? '' : 'wait'} ${pop} ${p.id === state.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
        ${avatar(p.name)}<span class="cname">${esc(p.name)}<small class="clabel">${label}</small></span><span class="cw-prog">${pr.grids ? `<b>${pr.grids}✓</b> ` : ''}${pr.found}/${total}</span>
      </li>`;
  });
  return `
      <aside class="roster" aria-label="Joueurs">
        <div class="roster-head muted"><span>Grilles validées · mots</span><span class="dots">En cours</span></div>
        <ul>${chips.join('')}</ul>
      </aside>`;
}
