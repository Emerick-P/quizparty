// QuizParty — Écrans de jeu par phase (views[phase]) : salon, décompte, question, correction, podium…
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

const views = {
  tvpair: tvPairView,
  tvlobby: tvLobbyView,
  loading: () => `<main class="screen center"><p class="muted">Reconnexion…</p></main>`,

  home: () => {
    const name = store.get(NAME_KEY) || '';
    const invited = urlCode();
    return `
    <main class="screen home2">
      <section class="h-play">
        <h1>${invited ? `Salon ${esc(invited)}` : 'Jouer entre potes'}</h1>
        <p>${invited ? 'Tes potes t’attendent : choisis ton pseudo et rejoins-les.' : 'Un salon, un code, et c’est parti. Sur la télé ou juste sur vos téléphones.'}</p>
        <div class="h-btns">${invited
          ? '<button class="btn primary big" data-action="sheet" data-value="join">Rejoindre le salon</button>'
          : '<button class="btn primary" data-action="go" data-value="create">Créer un salon</button><button class="btn h-ghost" data-action="sheet" data-value="join">Rejoindre</button>'}</div>
        ${invited ? `<button class="link" onclick="history.replaceState(null,'','/');location.reload()">Créer mon propre salon plutôt</button>` : ''}
      </section>
      <div class="h-tiles">
        ${dailyTile()}
        ${potesTile()}
      </div>
      <div class="h-extras">
        ${TOUCH ? `<button class="chip-btn" data-action="sheet" data-value="tvinfo">${ico('tv')} Jouer sur la télé</button>` : ''}
        <button class="chip-btn" data-action="propose">${ico('bulb')} Proposer une question</button>
        ${installCard()}
      </div>
      <div class="h-foot">${themeToggle()}</div>
      <p class="credits"><a href="/confidentialite">Confidentialité</a> · <a href="/conditions">Conditions</a> · Données et jaquettes de jeux : <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB.com</a>. Les jaquettes et les sons des jeux appartiennent à leurs éditeurs respectifs.</p>
    </main>`;
  },

  lobby() {
    const host = isHost();
    const copied = Date.now() < copiedUntil;
    const count = `${state.players.length} joueur${state.players.length > 1 ? 's' : ''}`;
    const start = host
      ? '<button class="btn primary big sticky-bottom" data-action="start">Lancer la partie</button>'
      : `<p class="waiting">En attente de ${esc(state.players.find((p) => p.id === state.hostId)?.name || "l'hôte")}</p>`;
    if (!wide()) {
      // Téléphone : l'essentiel sur un écran (code, joueurs, jeu choisi) ; le reste s'ouvre en page ou en panneau
      const linked = state.players.find((p) => p.id === state.you)?.steam?.status === 'ok';
      return `
    <main class="screen lobby lobby-m">
      <section class="lm-code">
        <button class="code" data-action="copycode" aria-label="Copier le code ${esc(state.code)}">${esc(state.code)}<small>Code du salon</small></button>
        <div class="lm-chips">
          <button class="chip-btn ${copied ? 'copied' : ''}" data-action="copycode" aria-live="polite">${copied ? `${ico('check')} Code copié` : `${ico('copy')} Copier le code`}</button>
          ${host && !state.tv && TOUCH ? `<button class="chip-btn tv-chip" data-action="tvsheet">${ico('tv')} Sur la télé</button>` : ''}
          <button class="chip-btn" data-action="sheet" data-value="note">${ico('lock')} Entre potes</button>
        </div>
      </section>
      ${state.tv ? tvCard() : ''}
      <button class="lm-players" data-action="sheet" data-value="players" aria-label="Voir les joueurs (${count})">
        ${state.players.map((p) => `<span class="lm-pl ${p.connected ? '' : 'off'}" data-key="${p.id}">${avatar(p.name)}${p.id === state.hostId ? '<i>hôte</i>' : ''}<small>${esc(p.name)}</small></span>`).join('')}
      </button>
      <div class="lm-main">
        <div class="lm-label">Ce soir on joue à</div>
        ${heroCard(host)}
      </div>
      ${start}
      <nav class="lm-foot">
        ${state.gamesPlayed ? `<button class="link" data-action="sheet" data-value="scores">${ico('trophy')} Score global</button>` : ''}
        <button class="link" data-action="sheet" data-value="steam">${ico('gamepad')} ${linked ? 'Steam lié' : 'Mon Steam'}</button>
        <button class="link" data-action="propose">${ico('bulb')} Proposer</button>
      </nav>
    </main>`;
    }
    // Ordinateur : joueurs à gauche, jeu choisi au centre, réglages à droite, « Lancer » en bas.
    return `
    <main class="screen lobby">
      <section class="code-card">
        <div class="label">Code du salon</div>
        <div class="code">${esc(state.code)}</div>
        <button class="btn small ghost share-btn ${copied ? 'copied' : ''}" data-action="share" aria-live="polite">${copied ? 'Lien copié' : 'Copier le lien'}</button>
      </section>
      ${tvCard()}
      <p class="share-note">${SHARE_NOTE}</p>
      <div class="lobby-cols">
      <div class="lb-players">
      <section class="card">
        <h2>Joueurs <span class="muted">${state.players.length}</span></h2>
        ${playersList(host)}
      </section>
      ${steamCard()}
      ${globalBoard()}
      ${proposeButton()}
      </div>
      <section class="lb-center">
        <div class="lm-label">Ce soir on joue à</div>
        ${heroCard(host)}
      </section>
      <section class="card lb-settings" style="--mc:${modeArt(state.settings.mode)[1]}">
        <h2>Réglages</h2>
        ${settingsBody(host)}
      </section>
      </div>
      ${start}
    </main>`;
  },

  countdown() {
    const r = state.round;
    return `
    <main class="screen center">
      <span class="pill">${r.kind === 'crossword' ? `${Math.round(r.durationMs / 60000)} min au chrono` : `Question ${r.index + 1} / ${r.total}`}</span>
      <div class="kind-label">${kindLabel(r)}</div>
      <div class="big-count" data-until="${r.startsAt}" data-mode="count">3</div>
      <p class="muted" ${r.kind === 'sound' ? 'data-sound-hint' : ''}>Prépare-toi…</p>
    </main>`;
  },

  question() {
    const r = state.round;
    if (r.kind === 'crossword') return SCREEN ? tvCrossword(r) : crosswordQuestion(r);
    const mine = r.yourAnswer ?? (pending && pending.roundId === r.id ? pending.answer : null);
    const answered = mine !== null;
    let body;
    let media = '';
    if (GUESS_KINDS.includes(r.kind)) {
      media = r.kind === 'cover' ? coverFigure(r.image, { until: r.endsAt, from: r.startsAt, input: r.input })
        : r.kind === 'sound' ? soundFigure(r)
        : r.kind === 'emoji' ? emojiLine(r.emojis)
        : `<blockquote class="pitch">${r.pitch ? esc(r.pitch) : '<span class="muted">Le serveur n’est pas à jour : relance-le pour voir le pitch.</span>'}</blockquote>`;
      if (r.input === 'choice') {
        body = `<div class="choices compact n${r.choices.length}">
          ${r.choices.map((c, i) => `
            <button class="choice c${i} ${answered ? (mine === i ? 'picked' : 'dim') : ''}" data-action="answer" data-index="${i}" ${answered ? 'disabled' : ''}>
              <span class="shape">${SHAPES[i]}</span><span>${esc(c)}</span>
            </button>`).join('')}
        </div>`;
      } else {
        body = guessBody(r, mine, /console/.test(r.prompt) ? 'Nom de la console' : /plateforme/.test(r.prompt) ? 'Nom de la plateforme' : /marque/.test(r.prompt) ? 'Nom de la marque' : 'Nom du jeu');
      }
    } else if (r.kind === 'typed') {
      body = guessBody(r, mine, 'Ta réponse');
    } else if (r.kind === 'estimation') {
      body = answered
        ? `<div class="sent-box">Ta réponse<b>${r.year ? mine : `${nf.format(mine)} ${esc(r.unit)}`}</b></div>`
        : `<form class="est" data-form="est">
             <div class="inrow"><input id="est-input" inputmode="${r.year ? 'numeric' : 'decimal'}" autocomplete="off" placeholder="${r.year ? 'Année' : '?'}" enterkeyhint="send">
             ${r.unit ? `<span class="unit">${esc(r.unit)}</span>` : ''}</div>
             <button class="btn primary big" type="submit">Valider</button>
           </form>`;
    } else {
      body = `<div class="choices n${r.choices.length}">
        ${r.choices.map((c, i) => `
          <button class="choice c${i} ${answered ? (mine === i ? 'picked' : 'dim') : ''}" data-action="answer" data-index="${i}" ${answered ? 'disabled' : ''}>
            ${r.choices.length > 2 ? `<span class="shape">${SHAPES[i]}</span>` : ''}<span>${esc(c)}</span>
          </button>`).join('')}
      </div>`;
    }
    // Écran télé : on n'y répond pas, les champs de saisie deviennent une consigne
    if (SCREEN && !/class="choices/.test(body)) body = `<p class="tv-answer">${ico('phone')} Réponds sur ton téléphone${r.tries > 1 ? ` · ${r.tries} essais` : ''}</p>`;
    if (SCREEN) return tvQuestion(r, media);
    if (controller()) return padQuestion(r, body, answered);
    return `
    <main class="screen has-side">
      <div class="play">
      <div class="qhead">
        <span class="pill">${state.daily?.number ? `n°${state.daily.number} · ` : ''}${r.index + 1} / ${r.total}</span>${state.daily ? dailyProgress() : ''}
        <span class="timer" data-until="${r.endsAt}" data-mode="count" data-urgent="5000"></span>
      </div>
      <div class="bar"><div class="bar-fill" data-until="${r.endsAt}" data-total="${r.durationMs}" data-mode="bar" data-urgent="5000"></div></div>
      ${['pitch', 'emoji', 'sound'].includes(r.kind) ? `<h1 class="prompt small">${esc(r.prompt)}</h1>` : ''}
      ${aboutLine(r)}
      ${r.picture ? gamePicture(r.picture) : ''}
      ${GUESS_KINDS.includes(r.kind) ? media : `<h1 class="prompt">${esc(r.prompt)}</h1>`}
      <div class="q-answer">${body}</div>
      </div>
      ${state.daily ? '' : roster(r)}
      ${state.daily ? dailyBar() : isHost() ? `<div class="host-bar">${reportButton()}<button class="btn small ghost" data-action="skip">Passer</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : ''}
    </main>`;
  },

  reveal() {
    const r = state.round;
    // Réponse tapée : pour ceux qui n'ont pas trouvé, leurs dernières saisies (même sans réponse finale)
    const guessesText = (g) => g.map((t) => `« ${esc(t)} »`).join(' · ');
    const resultList = () => `
        <ul class="list">
          ${[...state.reveal.results, ...(state.reveal.missed || []).map((m) => ({ ...m, correct: false, points: 0 }))].map((x) => `
            <li class="${x.playerId === state.you ? 'me' : ''}">
              <span class="pos">${x.correct ? '✓' : '✗'}</span>
              <span class="grow">${esc(x.name)}<span class="sub ${x.guesses?.length ? 'guesses' : ''}">${x.guesses?.length ? guessesText(x.guesses) : esc(x.answerText)}${x.correct ? ` · ${(x.timeMs / 1000).toFixed(1)} s` : ''}</span></span>
              <span class="delta">+${x.points}</span>
            </li>`).join('')}
        </ul>`;
    const rv = state.reveal;
    const me = rv.results.find((x) => x.playerId === state.you);
    const last = r.index + 1 >= r.total;

    let banner;
    if (r.kind === 'crossword') {
      const g = me?.grids ?? 0, f = me?.found ?? 0;
      banner = !me ? '<div class="result none">Aucun mot trouvé</div>'
        : `<div class="result ${me.rank === 1 ? 'good' : me.points ? '' : 'bad'}">${me.rank === 1 ? '1ᵉʳ !' : `${me.rank}ᵉ`}<small>${g} grille${g > 1 ? 's' : ''} validée${g > 1 ? 's' : ''} · ${f} mot${f > 1 ? 's' : ''} dans la suivante · +${me.points} pts</small></div>`;
    } else if (me?.self) {
      const good = me.correct;
      banner = `<div class="result ${good ? 'good' : 'bad'}">${good ? 'Tu te connais bien !' : 'Même toi, tu ne savais pas !'}<small>Question sur toi : pas de points${r.kind === 'estimation' ? ` · ${esc(me.errorText)}` : ''}</small></div>`;
    } else if (!me) banner = `<div class="result none">${TYPED_KINDS.includes(r.kind) && r.yourMisses ? 'Pas trouvé' : 'Pas de réponse'}</div>`;
    else if (r.kind === 'estimation') {
      const title = me.exact ? 'Pile poil !' : me.rank === 1 ? 'Le plus proche !' : `${me.rank}ᵉ`;
      banner = `<div class="result ${me.points > 0 ? 'good' : 'bad'}">${title}<small>+${me.points} pts · ${esc(me.errorText)}</small></div>`;
    } else {
      banner = me.correct
        ? `<div class="result good">Bonne réponse !<small>+${me.points} pts · ${(me.timeMs / 1000).toFixed(1)} s</small></div>`
        : '<div class="result bad">Raté !<small>+0 pt</small></div>';
    }

    let detail;
    if (r.kind === 'crossword') {
      const mine = r.yourWords || {};
      const sol = rv.grids?.[r.gridIndex];
      detail = `
        <ul class="list">
          ${rv.results.map((x) => `
            <li class="${x.playerId === state.you ? 'me' : ''}">
              <span class="pos">${x.rank}</span>
              <span class="grow">${esc(x.name)}<span class="sub">${esc(x.answerText)}${x.tiebreak != null ? ` · dernier mot à ${Math.floor(x.tiebreak / 60000)}:${String(Math.floor(x.tiebreak / 1000) % 60).padStart(2, '0')}` : ''}</span></span>
              <span class="delta">+${x.points}</span>
            </li>`).join('')}
        </ul>
        ${sol ? `<div class="cw reveal">
          <h2>Solution de ta grille ${r.gridIndex + 1}</h2>
          <div class="cw-board">${cwGrid(r, sol, { solution: true, mine })}</div>
          <p class="muted cw-legend"><span class="sw ok"></span> trouvé par toi <span class="sw miss"></span> pas trouvé</p>
          ${cwClues(sol, { found: mine, solution: true })}
        </div>` : ''}`;
    } else if (GUESS_KINDS.includes(r.kind)) {
      const img = rv.image;
      detail = `
        <div class="cover-reveal ${img ? '' : 'no-img'}">
          ${img ? coverFigure(img, { clear: true }) : ''}
          <div class="cover-meta">
            <div class="val">${esc(rv.correctText)}</div>
            <div class="muted">${rv.year ?? ''}${img?.publisher ? ` · ${esc(img.publisher)}` : ''}</div>
            ${img ? `<div class="credit">Jaquette${img.publisher ? ` © ${esc(img.publisher)}` : ''} · via <a href="${esc(img.pageUrl || img.sourceUrl)}" target="_blank" rel="noopener">${esc(img.source)}</a></div>` : ''}
          </div>
        </div>
        ${rv.pitch ? `<blockquote class="pitch done">${esc(rv.pitch)}</blockquote>` : ''}
        ${r.kind === 'sound' ? `<div class="sound-why">${soundFigure(r)}<div>${rv.what ? `<p>${esc(rv.what)}</p>` : ''}<div class="credit">${esc(rv.credit || '')}${rv.sourceUrl ? ` · <a href="${esc(rv.sourceUrl)}" target="_blank" rel="noopener">source</a>` : ''}</div></div></div>` : ''}
        ${rv.emojis ? `<div class="emoji-why">${emojiLine(rv.emojis, true)}${rv.why ? `<p>${esc(rv.why)}</p>` : ''}</div>` : ''}
        ${r.input === 'choice' ? `
        <div class="choices reveal n${r.choices.length}">
          ${r.choices.map((c, i) => `
            <div class="choice c${i} ${i === rv.correctIndex ? 'correct' : 'wrong'}">
              <span>${esc(c)}${me && me.answer === i ? '<span class="mine">toi</span>' : ''}</span>
              <span class="count">${rv.counts[i]}</span>
            </div>`).join('')}
        </div>` : resultList()}`;
    } else if (r.kind === 'typed') {
      detail = `
        <div class="truth"><div class="muted">Réponse</div><div class="val">${esc(rv.correctText)}</div></div>
        ${rv.info ? `<p class="info">${esc(rv.info)}</p>` : ''}
        ${resultList()}`;
    } else if (r.kind === 'estimation') {
      detail = `
        <div class="truth"><div class="muted">Réponse</div><div class="val">${esc(rv.correctText)}</div></div>
        ${rv.info ? `<p class="info">${esc(rv.info)}</p>` : ''}
        <ul class="list">
          ${rv.results.map((x) => `
            <li class="${x.playerId === state.you ? 'me' : ''}">
              <span class="pos">${x.rank ?? '–'}</span>
              <span class="grow">${esc(x.name)}${x.self ? ' <em class="muted">(sa question)</em>' : ''}<span class="sub">${esc(x.answerText)} · ${esc(x.errorText)}</span></span>
              <span class="delta">+${x.points}</span>
            </li>`).join('')}
        </ul>`;
    } else {
      detail = `
        <div class="choices reveal n${r.choices.length}">
          ${r.choices.map((c, i) => `
            <div class="choice c${i} ${i === rv.correctIndex ? 'correct' : 'wrong'}">
              <span>${esc(c)}${me && me.answer === i ? '<span class="mine">toi</span>' : ''}</span>
              <span class="count">${rv.counts[i]}</span>
            </div>`).join('')}
        </div>
        ${rv.info ? `<p class="info">${esc(rv.info)}</p>` : ''}`;
    }

    const board = sortedByScore().slice(0, 8);
    // Téléphone : « Réponse » et « Classement » sont deux pages qu'on fait glisser du doigt (le haut et les boutons restent fixes)
    const swipe = !SCREEN && !state.daily && !(controller() && r.kind !== 'crossword');
    return `
    <main class="screen reveal-screen">
      <div class="qhead"><span class="pill">${r.kind === 'crossword' ? 'Fin du chrono' : `${r.index + 1} / ${r.total}`}</span><span class="muted">${last ? 'Résultats' : r.kind === 'crossword' ? 'Grille suivante' : 'Question suivante'} dans <span data-until="${state.phaseEndsAt}" data-mode="count"></span> s</span></div>
      <div class="bar thin"><div class="bar-fill" data-until="${state.phaseEndsAt}" data-total="${state.phaseEndsAt - state.phaseStartedAt}" data-mode="bar"></div></div>
      ${SCREEN ? '' : `<div class="rv-top">${banner}${state.daily ? dailyProgress() : ''}</div>`}
      <div class="rv-swipe ${swipe ? 'on' : ''}" data-swipe>
      <div class="rv-main rv-page">
      ${controller() && r.kind !== 'crossword' ? `<p class="tv-hint">${ico('tv')} La correction est sur la télé</p>` : `
      ${GUESS_KINDS.includes(r.kind) || r.kind === 'crossword' ? '' : `<p class="prompt small">${esc(r.prompt)}</p>`}
      ${rv.picture ? gamePicture(rv.picture, true) : ''}
      ${detail}`}
      </div>
      <div class="rv-side rv-page" ${state.daily && !wide() ? 'hidden' : ''}>
      ${state.daily ? `<section class="card d-side">
        <h2>${state.daily.challenge ? `Défi de ${esc(state.daily.challenge.by)}` : `Défi n°${state.daily.number}`}</h2>
        <div class="d-result"><b>${fmtPts(state.players.find((p) => p.id === state.you)?.score)} <span>pts</span></b>${cellsHtml(state.daily.cells.map((c) => CELL_CLASS[c] ?? ''), 'big')}<small>${state.daily.correct} trouvée${state.daily.correct > 1 ? 's' : ''} sur ${r.index + 1}</small></div>
      </section>` : `<section class="card">
        <h2>Classement</h2>
        <ul class="list">
          ${board.map((p, i) => `
            <li class="${p.id === state.you ? 'me' : ''}">
              <span class="pos">${i + 1}</span>${avatar(p.name)}
              <span class="grow">${esc(p.name)}</span>
              ${p.lastPoints ? `<span class="delta">+${p.lastPoints}</span>` : ''}
              <span class="pts">${p.score}</span>
            </li>`).join('')}
        </ul>
      </section>`}
      ${state.admin && ['cover', 'sound'].includes(r.kind) ? `<div class="host-bar ban-bar">${r.banned ? `<span class="muted">${r.kind === 'sound' ? 'Son retiré' : 'Jeu retiré'} des prochaines parties</span>` : `<button class="link danger" data-action="ban">Retirer ${r.kind === 'sound' ? 'ce son' : 'ce jeu'} des prochaines parties</button>`}</div>` : ''}
      </div>
      </div>
      ${swipe ? `<div class="rv-dots" role="tablist" aria-label="Pages de la correction">
        <button class="rv-dot" data-action="rvpage" data-value="0" role="tab"><i></i>Réponse</button>
        <button class="rv-dot" data-action="rvpage" data-value="1" role="tab"><i></i>Classement</button>
      </div>` : ''}
      ${state.daily ? dailyBar(`<button class="btn small primary" data-action="skip">${last ? 'Voir mon résultat' : 'Suivant'}</button>`) : isHost() ? `<div class="host-bar rv-host">${reportButton()}<button class="btn small ghost" data-action="skip">${last ? 'Voir les résultats' : 'Suivant'}</button><button class="btn small ghost" data-action="stop">Arrêter</button></div>` : playerBar()}
    </main>`;
  },

  end() {
    if (state.daily) return state.daily.challenge ? potesEnd() : dailyEnd();
    const ranked = sortedByScore();
    const step = (p, place) => (p ? `
      <div class="step p${place}">
        ${avatar(p.name)}
        <span class="pname">${esc(p.name)}</span>
        <span class="score">${p.score} pts</span>
        <div class="block">${place}</div>
      </div>` : '<div></div>');
    const myPos = ranked.findIndex((p) => p.id === state.you) + 1;
    return `
    <main class="screen">
      <div class="title">${myPos === 1 ? 'Victoire' : 'Partie terminée'}</div>
      ${SCREEN ? '<p class="waiting tv-only">L’hôte peut relancer une partie depuis son téléphone</p>' : ''}
      <div class="podium">${step(ranked[1], 2)}${step(ranked[0], 1)}${step(ranked[2], 3)}</div>
      <section class="card">
        <ul class="list">
          ${ranked.map((p, i) => `
            <li class="${p.id === state.you ? 'me' : ''}">
              <span class="pos">${i + 1}</span>${avatar(p.name)}
              <span class="grow">${esc(p.name)}</span>
              <span class="pts">${p.score}</span>
            </li>`).join('')}
        </ul>
      </section>
      ${globalBoard()}
      ${SCREEN ? '' : isHost()
        ? '<button class="btn primary big sticky-bottom" data-action="lobby">Nouvelle partie</button>'
        : '<p class="waiting">En attente de l\'hôte pour une nouvelle partie</p>'}
      ${SCREEN ? '' : '<button class="link" data-action="leave">Quitter le salon</button>'}
    </main>`;
  },
};
