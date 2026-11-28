// QuizParty — Mode télé : vues de l’écran télé et du téléphone en manette.
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  mode télé : vues
/** Salon, côté téléphone : l'hôte branche (ou éteint) la télé ; les autres savent qu'elle est là. */
const TOUCH = matchMedia('(pointer: coarse)').matches; // téléphone ou tablette : seuls appareils qui servent de manette
function tvCard() {
  if (!isHost()) return state.tv ? `<p class="tv-state">${ico('tv')} La partie s’affiche sur la télé</p>` : '';
  if (!state.tv && !TOUCH) return ''; // sur ordinateur, pas de bouton « Afficher sur la télé »
  if (state.tv) return `<section class="tv-card on"><span>${ico('tv')} <b>Télé connectée</b> · chacun joue sur son téléphone</span><button class="btn small ghost" data-action="tvoff">Éteindre</button></section>`;
  return `<button class="btn tv-open" data-action="tvsheet">${ico('tv')} Afficher sur la télé</button>`;
}

/** Feuille « Afficher sur la télé » (hôte, dans le salon). */
function tvSheet() {
  if (!tv.sheet || SCREEN || !state || state.phase !== 'lobby' || !isHost()) return '';
  return `
  <div class="tv-sheet-bg" data-action="tvclose"></div>
  <section class="tv-sheet" role="dialog" aria-modal="true" aria-label="Afficher sur la télé">
    <div class="tv-sheet-head"><h2>Afficher sur la télé</h2><button class="btn small ghost" data-action="tvclose" aria-label="Fermer">${ico('x')}</button></div>
    <div class="tv-opt">
      <b>⌨ Code de l’écran</b>
      <p>Sur la télé, un PC branché en HDMI, une console ou un Fire Stick : ouvre <span class="tv-url">${esc(location.host)}/tv</span>, puis tape ici les 4 chiffres affichés.</p>
      <form class="row" data-form="tvpin">
        <input id="tv-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="0000" aria-label="Code de la télé">
        <button class="btn primary" type="submit">Connecter</button>
      </form>
    </div>
    <p class="tv-note">La télé affiche les questions, les images et les sons ; chacun répond sur son téléphone. Sans télé, tout reste comme avant.</p>
  </section>`;
}

/** Écran télé en attente : son code à 4 chiffres, à taper sur le téléphone de l'hôte. */
function tvPairView() {
  const digits = (tv.pin || '····').split('');
  return `
  <main class="screen tv-pair">
    <div class="logo">${LOGO_HTML} <span class="tv-sub">· écran télé</span></div>
    <div class="tv-label">Code de cet écran</div>
    <div class="tv-digits">${digits.map((d) => `<span>${esc(d)}</span>`).join('')}</div>
    <p class="tv-steps">Sur ton téléphone, dans le salon : <b>Afficher sur la télé</b>, puis tape ce code.<br>Rien à saisir avec la télécommande.</p>
    ${fullHint()}
  </main>`;
}

/** Salon sur la télé : code et QR code pour rejoindre, joueurs, jeu choisi. */
function tvLobbyView() {
  const { settings, options } = state;
  const current = options.modes.find((m) => m.id === settings.mode);
  const host = state.players.find((p) => p.id === state.hostId);
  return `
  <main class="screen tv-lobby">
    <div class="tv-top"><div class="logo">${LOGO_HTML}</div><span class="tv-site">${esc(location.host)}</span></div>
    <div class="tv-lob">
      <section class="tv-code">
        <div class="tv-label">Rejoins la partie</div>
        <div class="code">${esc(state.code)}</div>
        <div class="tv-join"><img class="tv-qr" src="/qr/${esc(state.code)}.svg" alt="QR code du salon"><p>Scanne avec ton téléphone<br>ou tape le code <b>${esc(state.code)}</b> sur la page d’accueil.</p></div>
      </section>
      <section class="tv-players">
        <h2>Joueurs <span>${state.players.length}</span></h2>
        <ul>${state.players.map((p) => `<li data-key="${p.id}" class="${p.connected ? '' : 'off'}">${avatar(p.name)}<span>${esc(p.name)}</span>${p.id === state.hostId ? '<span class="tag">hôte</span>' : ''}</li>`).join('')}
        <li class="empty">+ en attente…</li></ul>
      </section>
    </div>
    <div class="tv-foot"><span class="mode-ico">${modeArt(settings.mode)[0]}</span><b>${esc(current?.name || '')}</b>
      <span class="muted">${current?.grids ? `${settings.rounds} min` : `${settings.rounds} questions · ${settings.duration} s`}</span>
      <span class="tv-wait">${esc(host?.name || 'L’hôte')} lance la partie depuis son téléphone</span></div>
    ${fullHint()}
  </main>`;
}

/**
 * Question sur la télé : les propositions sont sur les téléphones, la télé garde la place pour
 * la question (ou l'image, les emojis, le son) en grand et les joueurs, bien visibles, à côté.
 */
function tvQuestion(r, media) {
  const guess = GUESS_KINDS.includes(r.kind);
  const multi = r.tries > 1;
  const done = state.players.filter((p) => p.status).length;
  const found = state.players.filter((p) => p.status === 'found').length;
  const count = multi ? `${found} / ${r.expected} ${found > 1 ? 'ont' : 'a'} trouvé` : `${r.answeredCount} / ${r.expected} ${r.answeredCount > 1 ? 'ont' : 'a'} répondu`;
  const players = sortedByScore().filter((p) => p.connected || p.status).map((p) => {
    const status = p.status || '';
    const label = !p.connected ? 'hors ligne'
      : status === 'found' ? 'a trouvé ★' : status === 'missed' ? 'plus d’essais' : status === 'answered' ? 'a répondu ✓'
      : p.misses && multi ? `${p.misses} essai${p.misses > 1 ? 's' : ''} raté${p.misses > 1 ? 's' : ''}` : 'réfléchit…';
    return `<li data-key="${p.id}" class="tvp ${status || 'wait'} ${p.connected ? '' : 'off'}">${avatar(p.name)}<span class="tvp-name">${esc(p.name)}</span><span class="tvp-st">${label}</span><b class="tvp-pts">${p.score}</b></li>`;
  }).join('');
  const how = r.kind === 'estimation' ? 'Donne ton estimation sur ton téléphone'
    : r.input === 'text' || r.kind === 'typed' ? `Tape ta réponse sur ton téléphone${multi ? ` · ${r.tries} essais` : ''}`
    : 'Choisis ta réponse sur ton téléphone';
  return `
  <main class="screen tv-q ${guess ? 'tv-q-media' : 'tv-q-text'}">
    <div class="qhead">
      <span class="pill">${r.index + 1} / ${r.total}</span><span class="tv-kind">${esc(kindLabel(r))}</span>
      <span class="timer" data-until="${r.endsAt}" data-mode="count" data-urgent="5000"></span>
    </div>
    <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="5000"></div></div>
    <div class="tv-q-body">
      <section class="tv-q-main">
        ${aboutLine(r)}
        ${guess ? `<h1 class="prompt small">${esc(r.prompt)}</h1>${r.picture ? gamePicture(r.picture) : ''}<div class="tv-media">${media}</div>`
          : `${r.picture ? gamePicture(r.picture) : ''}<h1 class="prompt">${esc(r.prompt)}</h1>${r.kind === 'estimation' && r.unit ? `<p class="tv-unit">Réponse en ${esc(r.unit)}</p>` : ''}`}
        <p class="tv-answer">${ico('phone')} ${how}</p>
      </section>
      <aside class="tv-q-players">
        <div class="tv-q-count">${count}${done >= r.expected ? '' : '<span class="dots"></span>'}</div>
        <ul>${players}</ul>
      </aside>
    </div>
  </main>`;
}

/** Mots croisés sur la télé : chacun a sa grille sur son téléphone, la télé montre la course. */
function tvCrossword(r) {
  return `
  <main class="screen tv-cw">
    <div class="qhead"><span class="pill">Mots croisés</span><span class="timer" data-until="${r.endsAt}" data-mode="clock" data-urgent="30000"></span></div>
    <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="30000"></div></div>
    <h1 class="prompt">Les mêmes grilles pour tous : chacun remplit la sienne sur son téléphone</h1>
    ${cwRoster(r)}
  </main>`;
}

/** Téléphone en manette : la question est sur la télé, il ne reste que les réponses, en grand. */
function padQuestion(r, body, answered) {
  const me = state.players.find((p) => p.id === state.you);
  const rank = sortedByScore().findIndex((p) => p.id === state.you) + 1;
  const choice = /class="choices/.test(body);
  const watch = r.kind === 'sound' ? 'Écoute le son sur la télé' : GUESS_KINDS.includes(r.kind) ? 'Regarde la télé' : 'La question est sur la télé';
  return `
  <main class="screen pad-screen">
    <div class="qhead">
      <span class="pill">${r.index + 1} / ${r.total}</span><span class="pad-kind">${esc(kindLabel(r))}</span>
      <span class="timer" data-until="${r.endsAt}" data-mode="count" data-urgent="5000"></span>
    </div>
    <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="5000"></div></div>
    <p class="tv-hint">${ico('tv')} ${watch}</p>
    ${r.kind === 'estimation' && r.unit ? `<p class="pad-unit">Réponse en ${esc(r.unit)}</p>` : ''}
    <div class="pad-body ${choice ? 'pad-choices' : ''}">${body}</div>
    ${answered && choice ? `<p class="pad-sent">${ico('check')} Réponse envoyée · ${r.answeredCount} / ${r.expected} ont répondu</p>` : ''}
    ${me ? `<div class="pad-me">${avatar(me.name)}<span>${esc(me.name)} · ${rank}ᵉ</span><b>${me.score}</b></div>` : ''}
    ${isHost() ? `<div class="host-bar">${reportButton()}<button class="btn small ghost" data-action="skip">Passer</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : ''}
  </main>`;
}
