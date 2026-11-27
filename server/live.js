import crypto from 'node:crypto';
import { Room, COUNTDOWN_MS } from './room.js';
import { MODES, KINDS } from './games/index.js';
import { stats, answerRow } from './stats.js';
import { roundKey, priorOf } from './rating.js';
import { cellOf, gridText } from './daily.js';

/**
 * Quiz en direct, en solo : à heure fixe (heure de Paris), tout le monde reçoit les mêmes questions au même instant.
 *
 * - Un seul salon par créneau (LiveRoom) : un seul jeu de minuteries, donc un chrono identique pour tous
 *   (startsAt/endsAt en heure serveur, comme les salons). Chacun ne voit que lui-même : jamais les autres
 *   joueurs ni leur nombre (comptage dans les logs seulement).
 * - La salle d'attente ouvre LIVE_OPEN_MS avant l'heure ; on ne peut plus entrer une fois parti (reprise après
 *   une coupure réseau seulement). Pas d'inscription.
 * - Le direct fait bouger la cote (source 'live', poids 1) avec un petit bonus contre les voisins au classement.
 * - Tout est en mémoire : un redémarrage du serveur pendant un direct le coupe.
 */
export const LIVE_TZ = 'Europe/Paris';
export const LIVE_OPEN_MS = Number(process.env.LIVE_OPEN_MS ?? 5 * 60_000); // salle d'attente
const LIVE_MAX_PLAYERS = 1000;
const LIVE_REVEAL_MS = Number(process.env.LIVE_REVEAL_MS ?? 6000); // correction (pas de bouton « Suivant » en direct)
const VERSUS_NEIGHBOURS = 2; // cote : bonus contre les 2 joueurs juste au-dessus et juste en dessous
const NO_REPEAT = 1500; // questions tirées pour les derniers directs (environ une semaine), pas reposées ; en mémoire
const PARTS = ['quiz', 'vraifaux', 'estimation', 'covers', 'pitch', 'emoji']; // pas de sons (réservés)

/**
 * Un créneau par type de joueur. diff : niveau visé (a priori 1-5 de difficulty.json) ;
 * 'ramp' = de plus en plus dur (finale).
 */
export const LIVE_FORMATS = {
  midi: { name: 'Pause déj', tagline: 'Court et grand public, le temps d’un café', rounds: 10, duration: 15, level: 'easy', diff: 'easy' },
  brunch: { name: 'Brunch', tagline: 'Court et grand public, pour lancer le week-end', rounds: 10, duration: 15, level: 'easy', diff: 'easy' },
  soir: { name: 'Apéro', tagline: 'Tous les jeux mélangés, difficulté variée', rounds: 15, duration: 15, level: 'easy', diff: 'mixed' },
  nuit: { name: 'Hardcore', tagline: 'Les questions les plus dures, pour les vrais', rounds: 15, duration: 15, level: 'hard', diff: 'hard' },
  finale: { name: 'La finale', tagline: 'La grande du dimanche, de plus en plus dure', rounds: 20, duration: 15, level: 'hard', diff: 'ramp' },
};

/** Créneaux (heure de Paris) : semaine, samedi, dimanche. Modifiables par LIVE_SLOTS='{"week":[["12:45","midi"],…]}'. */
const DEFAULT_SLOTS = {
  week: [['12:45', 'midi'], ['18:30', 'soir'], ['22:00', 'nuit']],
  sat: [['11:00', 'brunch'], ['18:30', 'soir'], ['22:00', 'nuit']],
  sun: [['11:00', 'brunch'], ['18:30', 'soir'], ['21:00', 'finale']],
};
function slotTable() {
  try { return process.env.LIVE_SLOTS ? { ...DEFAULT_SLOTS, ...JSON.parse(process.env.LIVE_SLOTS) } : DEFAULT_SLOTS; } catch { return DEFAULT_SLOTS; }
}

// ---- heure de Paris
const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: LIVE_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function parisParts(t) {
  const o = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(t))) o[type] = Number(value);
  return o;
}
/** Instant (ms) d'une heure de Paris : « 2026-11-27 », 18, 30. Gère les changements d'heure. */
export function parisTime(day, h, m, sec = 0) {
  const [y, mo, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m, sec);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = parisParts(t);
    t += guess - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, sec);
  }
  return t;
}
const dayOf = (t) => { const p = parisParts(t); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const addDay = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** Créneaux d'une journée (heure de Paris), triés. */
export function slotsOf(day) {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  const table = slotTable();
  const list = wd === 0 ? table.sun : wd === 6 ? table.sat : table.week;
  return list.filter(([, f]) => LIVE_FORMATS[f]).map(([hm, format]) => {
    const [h, m, sec = 0] = hm.split(':').map(Number); // « 18:30 » (les tests donnent aussi les secondes)
    const startsAt = parisTime(day, h, m, sec);
    return { id: `${day}T${hm}`, day, time: hm, format, startsAt, opensAt: startsAt - LIVE_OPEN_MS };
  }).sort((a, b) => a.startsAt - b.startsAt);
}
/** Prochain créneau pas encore parti (celui dont la salle d'attente est peut-être ouverte). */
export function nextSlot(t = Date.now()) {
  const day = dayOf(t);
  for (let i = 0; i < 3; i++) {
    const s = slotsOf(addDay(day, i)).find((x) => x.startsAt > t);
    if (s) return s;
  }
  return null;
}
export function publicSlot(s, t = Date.now()) {
  if (!s) return null;
  const f = formatOf(s.format);
  return { id: s.id, time: s.time, day: s.day, format: s.format, name: f.name, tagline: f.tagline, rounds: f.rounds, duration: f.duration, startsAt: s.startsAt, opensAt: s.opensAt, open: t >= s.opensAt && t < s.startsAt };
}

// ---- questions d'un créneau
// Tests : parties courtes (LIVE_ROUNDS questions de LIVE_DURATION secondes)
function formatOf(id) {
  const f = LIVE_FORMATS[id];
  return { ...f, rounds: Number(process.env.LIVE_ROUNDS) || f.rounds, duration: Number(process.env.LIVE_DURATION) || f.duration };
}

/** Tire les questions selon le niveau visé, en piochant dans un lot 3 fois plus grand. */
export function buildLive(format, used) {
  const f = formatOf(format);
  const pool = MODES.mix.build(f.rounds * 3, used, { mixParts: PARTS, mixInput: 'mixed', level: f.level }, null);
  const prior = (r) => priorOf(roundKey(r, r.mixPart ?? 'mix') ?? '');
  // Niveau choisi jeu par jeu (sinon « dur » ne donnerait que des estimations), puis un de chaque jeu à tour de rôle
  const want = (r) => {
    const p = prior(r) + Math.random() * 0.8;
    return f.diff === 'easy' ? p : f.diff === 'hard' ? -p : Math.random();
  };
  const groups = new Map();
  for (const r of pool) {
    const k = r.mixPart ?? r.kind;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ r, w: want(r) });
  }
  const queues = [...groups.values()].map((g) => g.sort((x, y) => x.w - y.w)).sort(() => Math.random() - 0.5);
  const chosen = [];
  for (let i = 0; chosen.length < f.rounds && queues.some((q) => q.length); i++) {
    const q = queues[i % queues.length];
    if (q.length) chosen.push(q.shift().r);
  }
  // Finale : de plus en plus dur ; sinon l'ordre du tour de rôle (jamais deux fois le même jeu d'affilée)
  if (f.diff === 'ramp') chosen.sort((a, b) => prior(a) - prior(b));
  return chosen.map((r) => (r.kind === 'estimation' ? { ...r, absolute: true } : r));
}

/** Ordre des choix propre à chaque joueur (un « c'est la B » partagé ne sert à rien). */
const shuffled = (n) => {
  const o = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
};
const hasChoices = (r) => r.choices?.length > 2 && Number.isInteger(r.correctIndex) && (r.kind === 'qcm' || r.input === 'choice');

export class LiveRoom extends Room {
  constructor(io, code, slot, rounds, onClose) {
    super(io, code);
    this.isLive = true;
    this.slot = slot;
    this.format = formatOf(slot.format);
    this.maxPlayers = LIVE_MAX_PLAYERS;
    this.planned = rounds;
    this.onClose = onClose;
    this.settings = { ...this.settings, mode: 'mix', rounds: rounds.length, duration: this.format.duration, mixParts: PARTS, mixInput: 'mixed' };
    this.sessionId = `live-${slot.id}`;
    this.best = 0;
    // Pas d'hôte : personne ne peut passer, mettre en pause, arrêter ni retirer un joueur
    Object.defineProperty(this, 'hostId', { get: () => null, set: () => {}, configurable: true });
    this.schedule(slot.startsAt - COUNTDOWN_MS, () => this.start());
  }

  /** On n'entre que dans la salle d'attente. */
  addPlayer(name, socket) {
    if (this.phase !== 'lobby' || Date.now() >= this.slot.startsAt) throw new Error('Le direct a commencé : rendez-vous au prochain !');
    return super.addPlayer(name, socket);
  }

  start() {
    if (this.phase !== 'lobby') return;
    if (!this.players.size) return this.close();
    console.log(`[direct] ${this.slot.id} (${this.format.name}) : ${this.players.size} joueur(s)`);
    this.rounds = JSON.parse(JSON.stringify(this.planned));
    for (const r of this.rounds) if (hasChoices(r)) r.orders = new Map(); // ordre des choix de chaque joueur
    this.protectMedia();
    this.roundIndex = -1;
    this.nextRound(this.slot.startsAt - COUNTDOWN_MS); // 1re question à l'heure pile, pour tout le monde
  }

  orderOf(r, pid) {
    if (!r?.orders) return null;
    if (!r.orders.has(pid)) r.orders.set(pid, shuffled(r.choices.length));
    return r.orders.get(pid);
  }

  /** Réponse à 4 choix : l'index affiché chez le joueur est converti dans l'ordre du serveur. */
  answer(playerId, payload = {}) {
    const r = this.round;
    const o = r && r.id === payload.roundId ? this.orderOf(r, playerId) : null;
    const answer = o && Number.isInteger(Number(payload.answer)) ? o[Number(payload.answer)] ?? -1 : payload.answer;
    this.quiet = true;
    let res;
    try { res = super.answer(playerId, { ...payload, answer }); } finally { this.quiet = false; }
    this.sendTo(playerId);
    return res;
  }

  /** Durée fixe pour tous : on n'arrête pas la question quand « tout le monde » a répondu. */
  checkAllAnswered() {}

  endQuestion() {
    if (!this.round || !['countdown', 'question'].includes(this.phase)) return;
    this.quiet = true;
    try { super.endQuestion(); } finally { this.quiet = false; }
    // Correction plus courte (pas de « Suivant ») : même heure de fin pour tous
    this.clearTimers();
    this.phaseEndsAt = this.phaseStartedAt + LIVE_REVEAL_MS;
    this.schedule(this.phaseEndsAt, () => this.nextRound());
    for (const p of this.players.values()) this.best = Math.max(this.best, p.score);
    this.broadcast();
  }

  finish() {
    super.finish();
    console.log(`[direct] ${this.slot.id} terminé`);
  }

  // Joueurs qui entrent, partent ou se reconnectent : seul l'intéressé reçoit l'état (les autres ne voient personne)
  attach(player, socket) { this.quiet = true; try { super.attach(player, socket); } finally { this.quiet = false; } this.sendTo(player.id); }
  detach(socket) { this.quiet = true; try { super.detach(socket); } finally { this.quiet = false; } }
  removePlayer(id, reason) {
    if (reason === 'kick') throw new Error('Pas de ça en direct');
    this.quiet = true;
    try { super.removePlayer(id, reason); } finally { this.quiet = false; }
    if (!this.players.size && this.phase !== 'lobby') this.close();
  }
  setUser(...a) { this.quiet = true; try { super.setUser(...a); } finally { this.quiet = false; } this.sendTo(a[0]); }
  setLook(...a) { this.quiet = true; try { super.setLook(...a); } finally { this.quiet = false; } this.sendTo(a[0]); }
  renamePlayer() { throw new Error('Pseudo fixé pendant le direct'); }
  report(byId, payload) { this.quiet = true; try { return super.report(byId, payload); } finally { this.quiet = false; this.sendTo(byId); } }

  pause() { throw new Error('Pas de pause en direct'); }
  resume() {}
  skip() { throw new Error('Pas de « Passer » en direct'); }
  stop() { throw new Error('Le direct ne s’arrête pas'); }
  updateSettings() { throw new Error('Réglages fixes en direct'); }
  resetTotals() {}
  linkSteam() { throw new Error('Pas de « Ta bande » en direct'); }
  attachScreen() { throw new Error('Pas de mode télé en direct'); }

  broadcast() {
    if (this.quiet) return;
    super.broadcast();
  }

  sendTo(pid) {
    const p = this.players.get(pid);
    if (p?.connected && p.socketId) this.io.to(p.socketId).emit('state', this.view(p.id));
  }

  close() {
    this.destroy();
  }

  destroy() {
    super.destroy();
    this.onClose?.(this);
    this.onClose = null;
  }

  /** Salle d'attente encore vide : gardée jusqu'au départ (le ménage des salons vides ne la touche pas). */
  get waiting() {
    return this.phase === 'lobby' && Date.now() < this.slot.startsAt;
  }

  /** Cote et stats : chaque compte, avec un petit bonus contre ses voisins au classement final. */
  recordStats(players) {
    const accounts = players.filter((p) => p.user?.id);
    if (!accounts.length || !stats.enabled) return;
    const ranked = [...accounts].sort((a, b) => b.score - a.score);
    for (const p of accounts) {
      const answers = [];
      this.rounds.forEach((r, i) => {
        if (!r.scored) return;
        const a = r.answers?.get(p.id);
        answers.push(answerRow({ round: r, roundIndex: i, mode: 'mix', answered: !!a, result: { ...r.scored.get(p.id), timeMs: a?.timeMs } }));
      });
      const i = ranked.indexOf(p);
      const versus = ranked.slice(Math.max(0, i - VERSUS_NEIGHBOURS), i + VERSUS_NEIGHBOURS + 1)
        .filter((o) => o !== p && o.user.id !== p.user.id)
        .map((o) => ({ userId: o.user.id, score: p.score > o.score ? 1 : p.score < o.score ? 0 : 0.5 }));
      stats.recordGame({ userId: p.user.id, source: 'live', sessionId: this.sessionId, mode: 'live', score: p.score, rank: null, players: null, won: false, answers, versus })
        .then((game) => { this.showRating(p.id, game); this.sendTo(p.id); });
    }
  }

  showRating(pid, game) {
    this.quiet = true;
    try { super.showRating(pid, game); } finally { this.quiet = false; }
  }

  /** Mes cases (une par manche) : 🟩 vite, 🟨 trouvé, 🟥 raté. */
  cellsOf(pid) {
    return this.planned.map((_, i) => {
      const r = this.rounds[i];
      if (!r?.scored) return i < this.roundIndex || (i === this.roundIndex && this.phase === 'reveal') ? 'miss' : 'none';
      const res = r.scored.get(pid);
      const a = r.answers.get(pid);
      return cellOf(res && { kind: r.kind, correct: !!res.correct, exact: !!res.exact, points: res.points ?? 0, timeMs: a?.timeMs ?? Infinity, durationMs: r.durationMs });
    });
  }

  view(pid) {
    const v = super.view(pid);
    const me = v.players.find((p) => p.id === pid);
    v.players = me ? [me] : [];
    const r = this.round;
    const o = this.orderOf(r, pid);
    if (v.round) {
      delete v.round.answeredCount;
      delete v.round.expected;
      v.round.reported = 0;
      if (o) {
        v.round.choices = o.map((i) => r.choices[i]);
        if (Number.isInteger(v.round.yourAnswer)) v.round.yourAnswer = o.indexOf(v.round.yourAnswer);
      }
    }
    if (v.reveal) {
      const rv = { ...v.reveal };
      delete rv.counts; // combien ont choisi chaque réponse : trahirait le nombre de joueurs
      rv.results = (rv.results ?? []).filter((x) => x.playerId === pid).map((x) => (o && Number.isInteger(x.answer) ? { ...x, answer: o.indexOf(x.answer) } : x));
      if (rv.missed) rv.missed = rv.missed.filter((x) => x.playerId === pid);
      if (o && Number.isInteger(rv.correctIndex)) rv.correctIndex = o.indexOf(rv.correctIndex);
      v.reveal = rv;
    }
    const cells = pid ? this.cellsOf(pid) : [];
    const mine = this.players.get(pid);
    v.daily = {
      live: { ...publicSlot(this.slot), best: this.phase === 'end' ? this.best : null },
      cells,
      grid: gridText(cells.filter((c) => c !== 'none')),
      correct: this.rounds.filter((x) => x.scored?.get(pid)?.correct).length,
      rounds: this.planned.length,
      account: !!mine?.user,
    };
    return v;
  }
}

/** Les créneaux : salle d'attente ouverte à l'heure, questions tirées une fois, réveil du serveur. */
export class Live {
  constructor(manager) {
    this.manager = manager;
    this.rooms = new Map(); // id du créneau → LiveRoom
    this.used = new Set();
    this.recent = []; // clés posées dans les derniers directs (dans l'ordre)
    this.timer = null;
    this.plan();
    // Render (offre gratuite) s'endort après 15 min sans visite : on se garde éveillé autour d'un direct
    this.awake = setInterval(() => this.keepAwake(), 4 * 60_000);
    this.awake.unref?.();
  }

  /** Ouvre la salle d'attente du prochain créneau à l'heure (minuterie relancée à chaque créneau). */
  plan() {
    clearTimeout(this.timer);
    const s = nextSlot();
    if (!s) return;
    const wait = Math.min(Math.max(0, s.opensAt - Date.now()), 6 * 3600_000); // re-planifié toutes les 6 h au plus
    this.timer = setTimeout(() => {
      if (Date.now() >= s.opensAt) this.open(s);
      setTimeout(() => this.plan(), 1000).unref?.();
    }, wait);
    this.timer.unref?.();
  }

  /** La salle du créneau (créée à l'ouverture, avec ses questions). */
  open(s) {
    if (this.rooms.has(s.id)) return this.rooms.get(s.id);
    if (Date.now() >= s.startsAt || Date.now() < s.opensAt) return null;
    const before = new Set(this.used);
    const rounds = buildLive(s.format, this.used);
    for (const k of this.used) if (!before.has(k)) this.recent.push(k);
    while (this.recent.length > NO_REPEAT) this.used.delete(this.recent.shift());
    let code;
    do code = `D${crypto.randomBytes(6).toString('hex').toUpperCase()}`; while (this.manager.rooms.has(code));
    const room = new LiveRoom(this.manager.io, code, s, rounds, (rm) => {
      this.rooms.delete(s.id);
      if (this.manager.rooms.get(rm.code) === rm) this.manager.rooms.delete(rm.code);
    });
    this.rooms.set(s.id, room);
    this.manager.rooms.set(code, room);
    return room;
  }

  info(t = Date.now()) {
    const next = nextSlot(t);
    const day = dayOf(t);
    const today = slotsOf(day).map((s) => publicSlot(s, t));
    const upcoming = [...today.filter((s) => s.startsAt > t), ...slotsOf(addDay(day, 1)).map((s) => publicSlot(s, t))].slice(0, 4);
    return { next: publicSlot(next, t), upcoming };
  }

  /** Entrer dans la salle d'attente du créneau ouvert. */
  join(socket, name) {
    const s = nextSlot();
    if (!s || Date.now() < s.opensAt) throw new Error('La salle d’attente n’est pas encore ouverte');
    const room = this.open(s);
    if (!room) throw new Error('Le direct a commencé : rendez-vous au prochain !');
    this.manager.leave(socket);
    const p = room.addPlayer(name, socket);
    return { ok: true, code: room.code, token: p.token, playerId: p.id };
  }

  keepAwake() {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) return;
    const t = Date.now();
    const s = nextSlot(t - 30 * 60_000); // le créneau en cours (fin ≈ 30 min après le départ) ou le prochain
    const near = s && t > s.opensAt - 20 * 60_000 && t < s.startsAt + 30 * 60_000;
    if (near || this.rooms.size) fetch(`${url}/health`).catch(() => {});
  }
}
