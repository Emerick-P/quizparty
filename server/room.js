import crypto from 'node:crypto';
import { MODES, KINDS, modeList, MIX_PARTS, MIX_INPUTS } from './games/index.js';
import { emptyProgress, gridAt, VALIDATE_AT } from './games/crossword.js';
import { covers } from './images/index.js';
import { screens } from './images/screens.js';
import { sounds } from './images/sounds.js';
import { feedback, makeFeedback } from './feedback.js';
import { loadProfile, PRIVACY_URL } from './steam.js';

// ---- Réglages du moteur (surchargeables par variables d'environnement, utile pour les tests)
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS ?? 3000); // "3, 2, 1" avant chaque question
const REVEAL_MS = Number(process.env.REVEAL_MS ?? 8000);       // affichage de la correction
const ANSWER_GRACE_MS = 400;       // on attend les réponses encore "en vol" après la fin du timer
const MAX_LATENCY_COMP_MS = 250;   // compensation de latence maximale accordée à un joueur
const LOBBY_REMOVE_AFTER_MS = 45_000;
const HOST_HANDOFF_AFTER_MS = 20_000;
const GUESSES_SHOWN = 3;             // saisies montrées à la correction pour ceux qui n'ont pas trouvé
export const MAX_PLAYERS = 24;

// level : niveau des modes qui en ont un (pitch) : easy = jeux très grand public, hard = le reste
// input : format de réponse des modes qui le permettent (jaquette, pitch) : 4 choix ou nom tapé
// mixInput : réponse des manches du Mix (mixed = 4 choix ou tapée au hasard à chaque manche)
// mixParts : jeux que l'hôte a cochés pour le Mix (au moins un)
const OPTIONS = { rounds: [5, 10, 15, 20], duration: [10, 15, 20, 30], level: ['easy', 'hard'], input: ['choice', 'text'], mixInput: MIX_INPUTS, mixParts: MIX_PARTS };

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name.length ? name : null;
}

const shortId = () => crypto.randomBytes(5).toString('hex');

/**
 * Un salon. Le serveur est la seule source de vérité : phases, timers, réponses et scores
 * sont décidés ici, les clients ne font qu'afficher l'état reçu et envoyer des actions.
 */
export class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby'; // lobby | countdown | question | reveal | end
    this.settings = { mode: 'quiz', rounds: 10, duration: 15, level: 'easy', input: 'choice', mixInput: 'mixed', mixParts: [...MIX_PARTS] };
    this.rounds = [];
    this.roundIndex = -1;
    this.round = null;
    this.reveal = null;
    this.phaseStartedAt = null;
    this.phaseEndsAt = null;
    this.timers = new Set();
    this.paused = null; // { at, by } : partie figée par l'hôte (bouton ⚑ Signaler)
    this.used = new Set(); // questions déjà posées dans ce salon (pas de répétition d'une partie à l'autre)
    // Score global : cumul des parties terminées dans ce salon, jusqu'à remise à zéro par l'hôte
    this.gamesPlayed = 0;
    this.archive = new Map(); // pseudo (minuscules) → { total, wins } des joueurs partis, rendu s'ils reviennent
    this.emptySince = null;
    this.pingTimer = setInterval(() => this.pingAll(), 5000);
  }

  get channel() {
    return `room:${this.code}`;
  }

  // ------------------------------------------------------------------ joueurs

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  addPlayer(name, socket) {
    if (this.players.size >= MAX_PLAYERS) throw new Error(`Salon complet (${MAX_PLAYERS} joueurs max)`);
    const player = {
      id: shortId(),
      token: crypto.randomUUID(),
      name: this.uniqueName(name),
      socketId: null,
      connected: false,
      score: 0,
      lastPoints: 0,
      total: 0, // score global (cumul des parties terminées)
      wins: 0,  // parties gagnées (ex aequo compris)
      rtt: 80,
      timers: {},
      steam: null, // profil Steam lié (voir linkSteam) : { status, input, name, avatar, id, games, message }
    };
    // Un joueur parti puis revenu avec le même pseudo retrouve son score global
    const key = player.name.toLowerCase();
    const saved = this.archive.get(key);
    if (saved) {
      player.total = saved.total;
      player.wins = saved.wins;
      this.archive.delete(key);
    }
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.attach(player, socket);
    return player;
  }

  /** Associe un socket à un joueur (première connexion ou reconnexion). */
  attach(player, socket) {
    if (player.socketId && player.socketId !== socket.id) {
      // Le joueur s'est reconnecté ailleurs (autre onglet) : on coupe l'ancien
      const old = this.io.sockets.sockets.get(player.socketId);
      if (old) {
        old.leave(this.channel);
        old.data = {};
        old.emit('session:replaced');
      }
    }
    player.socketId = socket.id;
    player.connected = true;
    clearTimeout(player.timers.remove);
    clearTimeout(player.timers.handoff);
    socket.data.code = this.code;
    socket.data.playerId = player.id;
    socket.join(this.channel);
    this.emptySince = null;
    this.ping(player);
    this.broadcast();
  }

  /** Déconnexion réseau (pas un départ volontaire) : on garde le joueur un moment. */
  detach(socket) {
    const player = this.players.get(socket.data.playerId);
    if (!player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (this.phase === 'lobby') this.scheduleLobbyRemoval(player);
    if (this.hostId === player.id) {
      player.timers.handoff = setTimeout(() => {
        if (!player.connected && this.hostId === player.id) {
          this.handoffHost();
          this.broadcast();
        }
      }, HOST_HANDOFF_AFTER_MS);
    }
    if (this.connectedPlayers().length === 0) this.emptySince = Date.now();
    this.broadcast();
    this.checkAllAnswered();
  }

  scheduleLobbyRemoval(player) {
    clearTimeout(player.timers.remove);
    player.timers.remove = setTimeout(() => {
      if (!player.connected && this.phase === 'lobby') this.removePlayer(player.id);
    }, LOBBY_REMOVE_AFTER_MS);
  }

  removePlayer(id, reason) {
    const player = this.players.get(id);
    if (!player) return;
    clearTimeout(player.timers.remove);
    clearTimeout(player.timers.handoff);
    this.players.delete(id);
    // On garde son score global au cas où il revienne (sauf s'il a été retiré par l'hôte)
    if (reason !== 'kick' && (player.total || player.wins)) {
      this.archive.set(player.name.toLowerCase(), { total: player.total, wins: player.wins });
    }
    const socket = player.socketId && this.io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.leave(this.channel);
      socket.data = {};
      if (reason === 'kick') socket.emit('kicked');
    }
    if (this.hostId === id) this.handoffHost();
    if (this.connectedPlayers().length === 0) this.emptySince ??= Date.now();
    this.broadcast();
    this.checkAllAnswered();
  }

  handoffHost() {
    const candidates = [...this.players.values()].filter((p) => p.id !== this.hostId);
    const next = candidates.find((p) => p.connected) ?? candidates[0];
    this.hostId = next ? next.id : null;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  // ------------------------------------------------------------------ profils Steam (« Ta bande »)

  /** Ce qui dépend du salon pour les modes : les joueurs et leur profil Steam. */
  ctx() {
    return { players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, steam: p.steam })) };
  }

  /**
   * Lie le profil Steam d'un joueur (adresse du profil, identifiant personnalisé ou SteamID64).
   * Le chargement prend une seconde ou deux : le joueur voit « chargement » puis le résultat.
   * Les questions de la partie en cours ne changent pas (elles sont tirées au lancement).
   */
  async linkSteam(playerId, input) {
    const player = this.players.get(playerId);
    if (!player) throw new Error("Tu n'es dans aucun salon");
    const raw = String(input ?? '').trim().slice(0, 200);
    if (!raw) throw new Error('Colle l\'adresse de ton profil Steam');
    const seq = (player.steamSeq = (player.steamSeq ?? 0) + 1);
    player.steam = { status: 'loading', input: raw };
    this.broadcast();
    try {
      const data = await loadProfile(raw);
      if (player.steamSeq !== seq || !this.players.has(playerId)) return { ok: true };
      player.steam = { ...data, input: raw };
    } catch (err) {
      if (player.steamSeq !== seq || !this.players.has(playerId)) return { ok: true };
      player.steam = { status: 'error', input: raw, message: err.message };
    }
    this.broadcast();
    return { ok: true, status: player.steam.status, message: player.steam.message ?? null };
  }

  unlinkSteam(playerId) {
    const player = this.players.get(playerId);
    if (!player) throw new Error("Tu n'es dans aucun salon");
    player.steamSeq = (player.steamSeq ?? 0) + 1;
    player.steam = null;
    this.broadcast();
  }

  /** Ce que les autres voient du profil Steam d'un joueur (jamais la liste de ses jeux). */
  steamView(p, mine) {
    const st = p.steam;
    if (!st) return null;
    return {
      status: st.status,
      name: st.name ?? null,
      avatar: st.avatar ?? null,
      games: st.games?.length ?? 0,
      ...(mine ? { input: st.input, message: st.message ?? null, profileUrl: st.profileUrl ?? null, privacyUrl: PRIVACY_URL } : {}),
    };
  }

  // ------------------------------------------------------------------ latence

  /** Mesure l'aller-retour serveur → client → serveur, lissé dans le temps. */
  ping(player) {
    const socket = player.socketId && this.io.sockets.sockets.get(player.socketId);
    if (!socket) return;
    const sentAt = Date.now();
    socket.timeout(3000).emit('srv:ping', sentAt, (err) => {
      if (err) return;
      const rtt = Date.now() - sentAt;
      player.rtt = player.rtt * 0.6 + rtt * 0.4;
    });
  }

  pingAll() {
    for (const p of this.players.values()) if (p.connected) this.ping(p);
  }

  // ------------------------------------------------------------------ réglages

  updateSettings(s = {}) {
    if (!['lobby', 'end'].includes(this.phase)) throw new Error('Partie en cours');
    if (s.mode !== undefined) {
      if (!MODES[s.mode]) throw new Error('Mode inconnu');
      const why = MODES[s.mode].unavailable?.(this.ctx());
      if (why) throw new Error(why);
      this.settings.mode = s.mode;
    }
    if (s.rounds !== undefined) {
      if (!OPTIONS.rounds.includes(Number(s.rounds))) throw new Error('Nombre de questions invalide');
      this.settings.rounds = Number(s.rounds);
    }
    if (s.level !== undefined) {
      if (!OPTIONS.level.includes(s.level)) throw new Error('Niveau invalide');
      this.settings.level = s.level;
    }
    if (s.input !== undefined) {
      if (!OPTIONS.input.includes(s.input)) throw new Error('Format de réponse invalide');
      this.settings.input = s.input;
    }
    if (s.mixInput !== undefined) {
      if (!OPTIONS.mixInput.includes(s.mixInput)) throw new Error('Format de réponse invalide');
      this.settings.mixInput = s.mixInput;
    }
    if (s.mixPart !== undefined) {
      // Coche ou décoche un jeu du Mix ; le dernier jeu coché ne peut pas être retiré
      if (!OPTIONS.mixParts.includes(s.mixPart)) throw new Error('Jeu inconnu');
      const on = new Set(this.settings.mixParts);
      if (on.has(s.mixPart)) {
        if (on.size === 1) throw new Error('Garde au moins un jeu dans le Mix');
        on.delete(s.mixPart);
      } else on.add(s.mixPart);
      this.settings.mixParts = OPTIONS.mixParts.filter((id) => on.has(id));
    }
    if (s.duration !== undefined) {
      if (!OPTIONS.duration.includes(Number(s.duration))) throw new Error('Durée invalide');
      this.settings.duration = Number(s.duration);
    }
    this.broadcast();
  }

  // ------------------------------------------------------------------ déroulé de la partie

  schedule(at, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, Math.max(0, at - Date.now()));
    this.timers.add(t);
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  start() {
    if (!['lobby', 'end'].includes(this.phase)) throw new Error('Partie déjà en cours');
    const mode = MODES[this.settings.mode];
    const why = mode.unavailable?.(this.ctx());
    if (why) throw new Error(why);
    this.rounds = mode.build(this.settings.rounds, this.used, this.settings, this.ctx());
    if (!this.rounds.length) throw new Error('Aucune question disponible');
    for (const p of this.players.values()) {
      p.score = 0;
      p.lastPoints = 0;
      p.tiebreak = null;
      clearTimeout(p.timers.remove);
    }
    this.roundIndex = -1;
    this.nextRound();
  }

  nextRound() {
    this.clearTimers();
    this.paused = null;
    this.reveal = null;
    this.roundIndex++;
    if (this.roundIndex >= this.rounds.length) return this.finish();

    const now = Date.now();
    const r = this.rounds[this.roundIndex];
    r.id = `${this.roundIndex}-${shortId()}`;
    r.answers = new Map();
    r.misses = new Map(); // mauvaises tentatives, pour les manches à plusieurs essais
    // Tout est exprimé en heures absolues du serveur : chaque client convertit avec son
    // décalage d'horloge, donc tout le monde voit la question et le chrono au même instant.
    r.startsAt = now + COUNTDOWN_MS;
    // Certains types de manche donnent du temps en plus (taper un nombre, un titre…)
    // Les grilles de mots croisés ont leur propre chrono (plusieurs minutes, selon le nombre de mots)
    r.durationMs = KINDS[r.kind].durationMs?.(r, this.settings) ?? this.settings.duration * 1000 + (KINDS[r.kind].bonusMs?.(r) ?? 0);
    r.endsAt = r.startsAt + r.durationMs;
    this.round = r;

    this.setPhase('countdown', now, r.startsAt);
    this.scheduleRound(r);
    this.broadcast();
  }

  /** Programme le début de la question (si on est au « 3, 2, 1 ») et sa fin. */
  scheduleRound(r) {
    if (this.phase === 'countdown') {
      this.schedule(r.startsAt, () => {
        this.setPhase('question', r.startsAt, r.endsAt);
        this.broadcast();
      });
    }
    this.schedule(r.endsAt + ANSWER_GRACE_MS, () => this.endQuestion());
  }

  // ------------------------------------------------------------------ pause et retours de l'hôte

  /**
   * Hôte : fige la partie pour tout le monde. On note l'heure serveur de la pause ; chaque client
   * affiche le chrono figé à cette heure-là, donc tout le monde voit exactement le même temps restant.
   */
  pause() {
    if (this.paused) return;
    if (!this.round || !['countdown', 'question', 'reveal'].includes(this.phase)) throw new Error('Rien à mettre en pause');
    this.clearTimers();
    this.paused = { at: Date.now(), by: this.hostId };
    this.broadcast();
  }

  /** Hôte : reprise. Toutes les échéances sont décalées de la durée de la pause, puis reprogrammées. */
  resume() {
    if (!this.paused) return;
    const delta = Date.now() - this.paused.at;
    this.paused = null;
    this.phaseStartedAt += delta;
    if (this.phaseEndsAt) this.phaseEndsAt += delta;
    const r = this.round;
    if (['countdown', 'question'].includes(this.phase)) {
      r.startsAt += delta;
      r.endsAt += delta;
      this.scheduleRound(r);
    } else if (this.phase === 'reveal') {
      this.schedule(this.phaseEndsAt, () => this.nextRound());
    }
    this.broadcast();
    this.checkAllAnswered(); // un joueur a pu partir pendant la pause
  }

  /** Hôte : retour sur la question en cours, enregistré sur disque pour corriger les banques plus tard. */
  report(byId, payload = {}) {
    const r = this.round;
    if (!r || !['countdown', 'question', 'reveal'].includes(this.phase)) throw new Error('Pas de question en cours');
    const kind = KINDS[r.kind];
    const answers = [];
    for (const [pid, a] of r.answers) {
      answers.push({ name: this.players.get(pid)?.name ?? '?', answer: kind.answerText(r, a.value), correct: kind.isCorrect?.(r, a.value) ?? null });
    }
    for (const [pid, list] of r.misses ?? []) {
      for (const v of list) answers.push({ name: this.players.get(pid)?.name ?? '?', answer: kind.answerText(r, v), correct: false });
    }
    const entry = makeFeedback(payload, {
      round: r,
      mode: this.settings.mode,
      phase: this.phase,
      room: this.code,
      by: this.players.get(byId)?.name ?? null,
      answers: r.kind === 'crossword' ? [] : answers,
    });
    feedback.add(entry);
    r.reported = (r.reported ?? 0) + 1;
    if (payload.resume) this.resume();
    else this.broadcast();
    return { ok: true, id: entry.id };
  }

  setPhase(phase, startedAt = Date.now(), endsAt = null) {
    this.phase = phase;
    this.phaseStartedAt = startedAt;
    this.phaseEndsAt = endsAt;
  }

  answer(playerId, { roundId, answer } = {}) {
    const r = this.round;
    const player = this.players.get(playerId);
    if (!player || !r || r.id !== roundId || !['countdown', 'question'].includes(this.phase)) {
      return { error: 'Question terminée' };
    }
    if (r.answers.has(playerId)) return { error: 'Tu as déjà répondu' };

    const now = Date.now();
    if (now < r.startsAt - 150) return { error: 'Trop tôt !' };
    // On retire une demi-latence : un joueur avec une connexion lente n'est pas pénalisé
    // sur le temps de réponse ni sur la deadline.
    const comp = Math.min(MAX_LATENCY_COMP_MS, Math.max(0, player.rtt / 2));
    const effective = now - comp;
    // Pendant une pause, seules les réponses parties avant la pause comptent
    if (this.paused && effective > this.paused.at) return { error: 'Partie en pause' };
    if (effective > r.endsAt) return { error: 'Trop tard !' };

    const kind = KINDS[r.kind];
    const value = kind.validate(r, answer);
    if (value === null) return { error: 'Réponse invalide' };

    // Plusieurs essais : une mauvaise réponse n'est enregistrée qu'au dernier essai
    const maxTries = kind.tries?.(r) ?? 1;
    if (maxTries > 1 && !kind.isCorrect(r, value)) {
      const misses = r.misses.get(playerId) ?? [];
      misses.push(value);
      r.misses.set(playerId, misses);
      if (misses.length < maxTries) {
        this.broadcast(); // les autres voient l'essai raté dans la liste des joueurs
        return { wrong: true, triesLeft: maxTries - misses.length };
      }
    }

    const timeMs = Math.round(Math.min(r.durationMs, Math.max(0, effective - r.startsAt)));
    r.answers.set(playerId, { value, timeMs });
    this.broadcast();
    this.checkAllAnswered();
    // Avec plusieurs essais, le joueur sait tout de suite s'il a trouvé (c'est le principe)
    return maxTries > 1 ? { ok: true, timeMs, correct: kind.isCorrect(r, value) } : { ok: true, timeMs };
  }

  /**
   * Mots croisés : un mot tapé par un joueur (grid + wordId + lettres). Chacun avance à son rythme dans les
   * mêmes grilles ; sa progression est dans r.answers comme une réponse (voir games/crossword.js).
   * Dès VALIDATE_AT mots trouvés, la grille est validée et le joueur passe à la suivante.
   */
  crossword(playerId, { roundId, grid, wordId, letters } = {}) {
    const r = this.round;
    const player = this.players.get(playerId);
    if (!player || !r || r.kind !== 'crossword' || r.id !== roundId || this.phase !== 'question') {
      return { error: 'Partie terminée' };
    }
    const comp = Math.min(MAX_LATENCY_COMP_MS, Math.max(0, player.rtt / 2));
    const effective = Date.now() - comp;
    if (this.paused && effective > this.paused.at) return { error: 'Partie en pause' };
    if (effective > r.endsAt) return { error: 'Trop tard !' };
    const timeMs = Math.round(Math.min(r.durationMs, Math.max(0, effective - r.startsAt)));
    const value = r.answers.get(playerId)?.value ?? emptyProgress();
    // Mot d'une grille déjà quittée (message parti juste avant de changer de grille)
    if (Number(grid) !== value.grid) return { error: 'Grille déjà validée', stale: true };
    const g = gridAt(r, value.grid);
    const check = KINDS.crossword.checkWord(g, wordId, letters);
    if (!check) return { error: 'Mot invalide' };
    if (!check.correct) return { ok: true, correct: false };
    if (value.found[check.w.id] === undefined) {
      value.found[check.w.id] = timeMs;
      value.lastAt = timeMs;
    }
    let validated = false;
    if (Object.keys(value.found).length >= VALIDATE_AT) {
      validated = true;
      value.grids++;
      value.grid++;
      value.found = {};
      gridAt(r, value.grid); // prête tout de suite
    }
    r.answers.set(playerId, { value, timeMs: value.lastAt ?? timeMs });
    this.broadcast();
    return { ok: true, correct: true, word: check.w.word, validated };
  }

  /** Si tous les joueurs connectés ont répondu (ou fini leur grille), inutile d'attendre la fin du chrono. */
  checkAllAnswered() {
    const r = this.round;
    if (!r || !['countdown', 'question'].includes(this.phase) || this.paused) return;
    const connected = this.connectedPlayers();
    const finished = KINDS[r.kind].isFinished ?? (() => true);
    if (connected.length && connected.every((p) => r.answers.has(p.id) && finished(r, r.answers.get(p.id)))) this.endQuestion();
  }

  endQuestion() {
    const r = this.round;
    if (!r || !['countdown', 'question'].includes(this.phase)) return;
    this.clearTimers();
    this.paused = null;

    // On ignore les réponses de joueurs partis entre-temps
    for (const id of r.answers.keys()) if (!this.players.has(id)) r.answers.delete(id);

    const kind = KINDS[r.kind];
    // Question sur un joueur (« Ta bande ») : il peut répondre, mais ne marque pas et ne compte pas dans
    // le classement de la manche (sinon il prendrait la 1re place des estimations à coup sûr)
    const self = r.about && r.answers.has(r.about) ? r.answers.get(r.about) : null;
    const scored = kind.score(r, self ? new Map([...r.answers].filter(([pid]) => pid !== r.about)) : r.answers);
    if (self) {
      const own = kind.score(r, new Map([[r.about, self]])).get(r.about) ?? {};
      scored.set(r.about, { ...own, correct: own.exact ?? own.correct, rank: undefined, points: 0, self: true });
    }
    for (const p of this.players.values()) {
      p.lastPoints = scored.get(p.id)?.points ?? 0;
      p.score += p.lastPoints;
      // Départage des ex aequo (mots croisés : le premier à avoir trouvé son dernier mot)
      if (scored.get(p.id)?.tiebreak != null) p.tiebreak = scored.get(p.id).tiebreak;
    }

    const results = [...r.answers].map(([pid, a]) => ({
      playerId: pid,
      name: this.players.get(pid).name,
      answer: a.value,
      answerText: kind.answerText(r, a.value),
      timeMs: a.timeMs,
      ...scored.get(pid),
    }));
    results.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.points - a.points || a.timeMs - b.timeMs);

    // Réponse tapée avec plusieurs essais : on montre les dernières saisies de ceux qui n'ont pas trouvé,
    // y compris ceux qui ont raté des essais puis n'ont plus rien envoyé avant la fin du chrono.
    let missed;
    if ((kind.tries?.(r) ?? 1) > 1) {
      missed = [];
      for (const [pid, list] of r.misses) {
        const player = this.players.get(pid);
        if (!player || !list.length) continue;
        const guesses = list.slice(-GUESSES_SHOWN).map((v) => kind.answerText(r, v));
        const res = results.find((x) => x.playerId === pid);
        if (res) { if (!res.correct) res.guesses = guesses; } else missed.push({ playerId: pid, name: player.name, guesses });
      }
    }
    this.reveal = { ...kind.reveal(r, r.answers), info: r.info ?? null, picture: r.revealPicture ?? null, results, ...(missed ? { missed } : {}) };
    const now = Date.now();
    // Correction plus longue pour une grille : on a le temps de lire la solution
    this.setPhase('reveal', now, now + REVEAL_MS * (kind.revealFactor ?? 1));
    this.schedule(this.phaseEndsAt, () => this.nextRound());
    this.broadcast();
  }

  /** Hôte : retirer définitivement le jeu de la manche en cours (jaquette inadaptée, erreur…). */
  banCover() {
    const r = this.round;
    if (!r || !['cover', 'screen', 'sound'].includes(r.kind) || !['question', 'reveal'].includes(this.phase)) throw new Error('Pas d\'image à retirer');
    if (r.kind === 'sound') {
      // Un son retiré ne retire pas le jeu : il reste jouable dans les autres modes
      sounds.ban(r.soundId);
      r.banned = true;
      this.broadcast();
      return;
    }
    if (r.kind === 'screen') {
      // Une capture retirée ne retire pas le jeu : il reste jouable en Jaquette et Pitch
      screens.ban(r.screenId);
      r.banned = true;
      this.broadcast();
      return;
    }
    covers.ban(r.slug);
    r.banned = true;
    // Les manches suivantes de cette partie qui montreraient la même image sont retirées
    this.rounds = this.rounds.filter((x, i) => i <= this.roundIndex || x.slug !== r.slug);
    this.broadcast();
  }

  /** Hôte : passer la question en cours ou la correction. */
  skip() {
    if (['countdown', 'question'].includes(this.phase)) this.endQuestion();
    else if (this.phase === 'reveal') this.nextRound();
    else throw new Error('Rien à passer');
  }

  finish() {
    this.clearTimers();
    this.paused = null;
    // Seules les parties allées jusqu'au bout comptent dans le score global
    const players = [...this.players.values()];
    const best = Math.max(0, ...players.map((p) => p.score));
    // À score égal, le départage (s'il y en a un) désigne le vainqueur
    const tb = (p) => p.tiebreak ?? Infinity;
    const bestTb = Math.min(...players.filter((p) => p.score === best).map(tb));
    for (const p of players) {
      p.total += p.score;
      if (best > 0 && p.score === best && tb(p) === bestTb) p.wins++;
    }
    this.gamesPlayed++;
    this.round = null;
    this.reveal = null;
    this.setPhase('end');
    this.broadcast();
  }

  /** Hôte : retour au salon (arrêt en cours de partie, ou "nouvelle partie" depuis la fin). */
  stop() {
    this.clearTimers();
    this.paused = null;
    this.round = null;
    this.reveal = null;
    this.setPhase('lobby');
    for (const p of this.players.values()) if (!p.connected) this.scheduleLobbyRemoval(p);
    this.broadcast();
  }

  /** Hôte : remise à zéro du score global (entre deux parties). */
  resetTotals() {
    if (!['lobby', 'end'].includes(this.phase)) throw new Error('Partie en cours');
    for (const p of this.players.values()) {
      p.total = 0;
      p.wins = 0;
    }
    this.archive.clear();
    this.gamesPlayed = 0;
    this.broadcast();
  }

  // ------------------------------------------------------------------ diffusion

  view(pid) {
    const r = this.round;
    const inRound = r && ['countdown', 'question', 'reveal'].includes(this.phase);
    const mine = inRound ? r.answers.get(pid) : undefined;
    const kind = inRound ? KINDS[r.kind] : null;
    const multiTry = !!kind && (kind.tries?.(r) ?? 1) > 1;
    /**
     * Où en est chaque joueur sur la question en cours, visible par tous :
     * - une seule tentative (QCM, 4 choix, estimation) : seulement 'answered', jamais juste/faux,
     *   pour ne rien révéler avant la correction ;
     * - plusieurs tentatives (nom tapé) : 'found' ou 'missed' (3 essais ratés). Le joueur le sait
     *   déjà lui-même, et ça ne donne pas la réponse aux autres.
     */
    const statusOf = (id) => {
      const a = inRound ? r.answers.get(id) : undefined;
      if (!a) return null;
      if (kind.progressOf) return null; // mots croisés : la progression est dans `progress`
      if (!multiTry) return 'answered';
      return kind.isCorrect(r, a.value) ? 'found' : 'missed';
    };
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      you: pid,
      serverNow: Date.now(),
      settings: this.settings,
      options: { modes: modeList(this.ctx()), ...OPTIONS },
      phaseStartedAt: this.phaseStartedAt,
      phaseEndsAt: this.phaseEndsAt,
      gamesPlayed: this.gamesPlayed,
      // Partie figée par l'hôte : les clients affichent les chronos à l'heure serveur `at`
      paused: this.paused ? { at: this.paused.at, by: this.players.get(this.paused.by)?.name ?? null } : null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        lastPoints: p.lastPoints,
        total: p.total,
        wins: p.wins,
        connected: p.connected,
        answered: !!(inRound && r.answers.has(p.id)),
        status: statusOf(p.id),
        misses: multiTry ? r.misses?.get(p.id)?.length ?? 0 : 0, // essais ratés (nom tapé seulement)
        tiebreak: p.tiebreak ?? null, // départage des ex aequo (mots croisés), plus petit = mieux classé
        // Mots croisés : grilles validées et mots trouvés dans la grille en cours (jamais lesquels)
        progress: kind?.progressOf ? kind.progressOf(r, r.answers.get(p.id)?.value) : null,
        steam: this.steamView(p, p.id === pid),
      })),
      round: inRound
        ? {
            id: r.id,
            index: this.roundIndex,
            total: this.rounds.length,
            kind: r.kind,
            ...KINDS[r.kind].publicRound(r),
            // « Ta bande » : image du jeu et joueur concerné (il répond sans marquer)
            picture: r.picture ?? null,
            about: r.about ? { id: r.about, name: this.players.get(r.about)?.name ?? '?' } : null,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            durationMs: r.durationMs,
            yourAnswer: mine && !kind.forPlayer ? mine.value : null,
            yourMisses: r.misses?.get(pid)?.length ?? 0,
            // Mots croisés : ma grille en cours et mes mots trouvés (rendus aussi après une reconnexion)
            ...(kind.forPlayer ? kind.forPlayer(r, mine?.value) : {}),
            yourCorrect: mine && (KINDS[r.kind].tries?.(r) ?? 1) > 1 ? KINDS[r.kind].isCorrect(r, mine.value) : null,
            tries: KINDS[r.kind].tries?.(r) ?? 1,
            banned: !!r.banned,
            reported: r.reported ?? 0,
            answeredCount: r.answers.size,
            expected: this.connectedPlayers().length,
          }
        : null,
      reveal: this.phase === 'reveal' ? this.reveal : null,
      // Image de la manche suivante, préchargée pendant la correction : elle sera prête pour tous à l'heure
      preload: this.phase === 'reveal' ? this.rounds[this.roundIndex + 1]?.image?.url ?? this.rounds[this.roundIndex + 1]?.sound?.url ?? this.rounds[this.roundIndex + 1]?.picture?.url ?? null : null,
    };
  }

  /** Chaque joueur reçoit une vue personnalisée (sa propre réponse, son id). */
  broadcast() {
    for (const p of this.players.values()) {
      if (p.connected && p.socketId) this.io.to(p.socketId).emit('state', this.view(p.id));
    }
  }

  destroy() {
    this.clearTimers();
    clearInterval(this.pingTimer);
    for (const p of this.players.values()) {
      clearTimeout(p.timers.remove);
      clearTimeout(p.timers.handoff);
    }
  }
}
