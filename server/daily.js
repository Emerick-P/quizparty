import crypto from 'node:crypto';
import { Room } from './room.js';
import { MODES, KINDS } from './games/index.js';
import { covers } from './images/index.js';
import { store } from './store.js';
import { stats, answerRow } from './stats.js';

/**
 * Défi du jour : le même quiz figé pour tout le monde, de minuit à minuit (heure de Paris).
 *
 * - Le défi est tiré une fois par jour (Mix de 10 manches) et gardé dans daily_challenges : un redémarrage
 *   du serveur (Render) ou un déploiement dans la journée ne le change pas.
 * - Chacun le joue seul, dans un salon solo (DailyRoom) qui réutilise tout le moteur des parties :
 *   chrono serveur, compensation de latence, correction. Pas de pause ni de « Passer » sur une question.
 * - Compte connecté : une seule tentative (la ligne de daily_results est créée dès le départ ; quitter en
 *   cours garde les points déjà faits), classement du jour, série de jours joués d'affilée.
 *   Invité : il joue, sans classement ni série côté serveur (son navigateur garde son résultat).
 * - Chaque réponse part aussi dans les stats (server/stats.js, table answers) quand ce module existe.
 */
export const DAILY_ROUNDS = 10;
export const DAILY_DURATION = 15; // secondes par manche (+ temps en plus des manches à taper)
// Modes du Mix utilisés : pas « Ta bande » (profils Steam du salon) ni les mots croisés (partie entière)
// Sans les modes réservés (sons : voir RESERVED_MODES), ouverts à tous
export const DAILY_PARTS = ['quiz', 'vraifaux', 'estimation', 'covers', 'pitch', 'emoji'];
const EPOCH = process.env.DAILY_EPOCH || '2026-11-25'; // défi n° 1
const NO_REPEAT_DAYS = 30; // une question des 30 derniers défis n'est pas reposée
const TZ = 'Europe/Paris';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Date du jour à Paris, 'AAAA-MM-JJ'. */
export const dayKey = (t = Date.now()) => dayFmt.format(new Date(t));
const shiftDay = (day, delta) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
export const previousDay = (day) => shiftDay(day, -1);
export const dayNumber = (day) => Math.round((Date.parse(day) - Date.parse(EPOCH)) / 86400_000) + 1;
/** Heure (ms) du prochain défi : minuit à Paris. */
export function nextDayAt(t = Date.now()) {
  const today = dayKey(t);
  // Le décalage de Paris (1 h ou 2 h) : on cherche la première heure pleine où la date change
  let at = Math.ceil(t / 3600_000) * 3600_000;
  while (dayKey(at) === today) at += 3600_000;
  return at;
}

/** Une case du résultat partagé : 🟩 trouvé vite, 🟨 trouvé (ou estimation approchée), 🟥 raté. */
export function cellOf(entry) {
  if (!entry || !entry.points) return 'miss';
  if (entry.kind === 'estimation') return entry.exact || entry.points >= 600 ? 'fast' : 'slow';
  if (!entry.correct) return 'miss';
  return entry.timeMs <= entry.durationMs / 2 ? 'fast' : 'slow';
}
const CELL = { fast: '🟩', slow: '🟨', miss: '🟥' };
export const gridText = (cells) => cells.map((c) => CELL[c] ?? '⬛').join('');

// Stats de joueur (tables game_results et answers, voir stats.js) : source 'daily', session = le jour
async function recordStats(payload) {
  try { await stats.recordGame(payload); } catch (err) { console.error('[défi] stats :', err.message); }
}

const hasDb = () => typeof store.query === 'function';

/** Jaquettes : l'identifiant de l'image change quand le cache est refait (redémarrage de Render). */
function refreshImages(round) {
  if (!round.slug || !round.image?.url?.startsWith('/img/')) return round;
  const entry = covers.index?.[covers.key(round.slug)];
  if (entry?.status === 'ready') round.image = covers.publicImage(entry);
  return round;
}

/**
 * Anti-triche : chaque joueur d'un défi reçoit les 4 choix dans son propre ordre (un « c'est la B »
 * partagé ne sert à rien). Vrai/Faux garde son ordre. Les salons, eux, gardent le même ordre pour
 * tous (mode télé : la couleur à l'écran = la touche du téléphone).
 */
export function shuffleChoices(round) {
  const n = round.choices?.length;
  if (!(n > 2) || !Number.isInteger(round.correctIndex)) return round;
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  round.choices = order.map((i) => round.choices[i]);
  round.correctIndex = order.indexOf(round.correctIndex);
  return round;
}

export class Daily {
  constructor() {
    this.cache = new Map(); // jour → Promise<{ day, number, rounds }>
    this.starting = new Set(); // comptes en train de lancer leur défi
  }

  /** Le défi du jour (tiré une seule fois, puis relu). */
  challenge(day = dayKey()) {
    if (!this.cache.has(day)) {
      const p = this.load(day).catch((err) => { this.cache.delete(day); throw err; });
      this.cache.set(day, p);
      for (const k of this.cache.keys()) if (k < previousDay(day)) this.cache.delete(k);
    }
    return this.cache.get(day);
  }

  async load(day) {
    const saved = await store.get('daily_challenges', day).catch((err) => { console.error('[défi] lecture :', err.message); return null; });
    if (saved?.rounds?.length) return { day, number: dayNumber(day), rounds: await this.repair(day, saved) };
    // Questions des derniers défis : pas reposées
    const used = new Set();
    if (hasDb()) {
      const recent = await store.query('daily_challenges', { gte: { id: shiftDay(day, -NO_REPEAT_DAYS) }, select: 'id,keys', limit: NO_REPEAT_DAYS + 1 }).catch(() => []);
      for (const row of recent ?? []) for (const k of row.keys ?? []) used.add(k);
    }
    const before = new Set(used);
    const rounds = MODES.mix.build(DAILY_ROUNDS, used, { mixParts: DAILY_PARTS, mixInput: 'mixed', level: 'easy' }, null);
    if (!rounds.length) throw new Error('Défi indisponible pour le moment');
    const keys = [...used].filter((k) => !before.has(k));
    const row = { id: day, number: dayNumber(day), rounds: JSON.parse(JSON.stringify(rounds)), keys };
    // Deux serveurs (ou deux joueurs au même instant) : le premier défi enregistré fait foi
    try {
      await store.insert('daily_challenges', row);
    } catch {
      const again = await store.get('daily_challenges', day).catch(() => null);
      if (again?.rounds?.length) return { day, number: dayNumber(day), rounds: again.rounds };
    }
    return { day, number: row.number, rounds: row.rounds };
  }

  /**
   * Défi déjà tiré qui contient une manche devenue injouable (type de manche supprimé, comme HUD et Écran de
   * chargement) ou un mode réservé (tiré avant qu'ils soient exclus du défi) : ces manches sont remplacées par
   * de nouvelles, enregistrées pour que tous les joueurs suivants aient le même défi.
   */
  async repair(day, saved) {
    const bad = (r) => !KINDS[r.kind] || (r.mixPart && !DAILY_PARTS.includes(r.mixPart));
    const n = saved.rounds.filter(bad).length;
    if (!n) return saved.rounds;
    const used = new Set(saved.keys ?? []);
    let fresh = [];
    try {
      fresh = MODES.mix.build(n, used, { mixParts: DAILY_PARTS, mixInput: 'mixed', level: 'easy' }, null);
    } catch (err) {
      console.error('[défi] remplacement :', err.message);
    }
    const rounds = saved.rounds.flatMap((r) => (bad(r) ? (fresh.length ? [fresh.shift()] : []) : [r]));
    const row = { ...saved, rounds: JSON.parse(JSON.stringify(rounds)), keys: [...used] };
    await store.upsert('daily_challenges', row).catch((err) => console.error('[défi] remplacement :', err.message));
    console.log(`[défi] ${day} : ${n} manche(s) injouable(s) remplacée(s)`);
    return row.rounds;
  }

  /** Résultat d'un compte pour ce jour (null : pas encore joué). */
  result(day, userId) {
    if (!userId) return Promise.resolve(null);
    return store.get('daily_results', `${day}:${userId}`).catch(() => null);
  }

  /** Série en cours : jours joués d'affilée jusqu'à aujourd'hui (ou hier, si pas encore joué aujourd'hui). */
  async streak(day, userId) {
    const today = await this.result(day, userId);
    if (today) return today.streak ?? 1;
    const prev = await this.result(previousDay(day), userId);
    return prev?.streak ?? 0;
  }

  async leaderboard(day, limit = 50) {
    if (!hasDb()) return [];
    const rows = await store.query('daily_results', { eq: { day }, order: 'score.desc,started_at.asc', limit }).catch(() => []);
    return (rows ?? []).map((r) => ({ userId: r.user_id, name: r.name, avatar: r.avatar_url, score: r.score, grid: r.grid, finished: !!r.finished }));
  }

  /** Ce que l'accueil affiche : numéro, série, résultat et classement si déjà joué. */
  async info(user) {
    const day = dayKey();
    const [mine, streak] = await Promise.all([this.result(day, user?.id), user ? this.streak(day, user.id) : 0]);
    return {
      day,
      number: dayNumber(day),
      rounds: DAILY_ROUNDS,
      duration: DAILY_DURATION,
      nextAt: nextDayAt(),
      account: !!user,
      me: user?.id ?? null,
      streak,
      played: mine ? publicResult(mine) : null,
      leaderboard: mine ? await this.leaderboard(day) : null,
    };
  }

  /** Classement pour un invité qui a déjà joué (son résultat est dans son navigateur). */
  async board() {
    return this.leaderboard(dayKey());
  }
}

const publicResult = (r) => ({ score: r.score, grid: r.grid, correct: r.correct, rounds: r.rounds, streak: r.streak ?? 1, finished: !!r.finished });

/**
 * Salon solo du défi : la partie démarre tout de suite, sur les manches figées du jour.
 * Le moteur (chrono, réponses, correction) est celui des parties entre amis.
 */
export class DailyRoom extends Room {
  constructor(io, code, challenge, daily) {
    super(io, code);
    this.isDaily = true;
    this.dailyApi = daily;
    this.challenge = challenge;
    this.settings = { ...this.settings, mode: 'mix', rounds: DAILY_ROUNDS, duration: DAILY_DURATION, mixParts: DAILY_PARTS, mixInput: 'mixed' };
    this.log = []; // par manche : { kind, mode, correct, exact, points, timeMs, durationMs, answered, input, game }
    this.saved = null; // dernière ligne enregistrée (score en cours)
    this.done = false;
    this.startedAt = new Date().toISOString();
    this.leaderboard = null;
    this.streak = 0;
  }

  /** Compte qui joue (fixé au départ : il reste connu après « Quitter »). */
  get user() {
    return this.owner ?? null;
  }

  /** Les manches du jour, copiées (chaque joueur a sa partie). */
  start() {
    if (this.roundIndex >= 0) throw new Error('Le défi du jour ne se joue qu’une fois');
    this.rounds = JSON.parse(JSON.stringify(this.challenge.rounds)).map((r) => {
      if (r.kind === 'estimation') r.absolute = true; // seul : points selon l'écart, pas selon le rang
      return shuffleChoices(refreshImages(r));
    });
    this.protectMedia(); // défis déjà enregistrés avec des sons : servis à ce joueur seulement
    for (const p of this.players.values()) { p.score = 0; p.lastPoints = 0; }
    this.roundIndex = -1;
    this.nextRound();
  }

  pause() { throw new Error('Pas de pause pendant le défi du jour'); }
  resume() {}
  updateSettings() { throw new Error('Le défi du jour a des réglages fixes'); }
  resetTotals() {}
  linkSteam() { throw new Error('Pas de « Ta bande » dans le défi du jour'); }

  /** « Passer » seulement pendant la correction (pour aller plus vite), jamais sur une question. */
  skip() {
    if (this.phase === 'reveal') return this.nextRound();
    throw new Error('Pas de « Passer » pendant le défi du jour');
  }

  /** « Arrêter » : la partie s'arrête là, avec les points déjà faits. */
  stop() {
    if (this.phase === 'end') return;
    this.clearTimers();
    this.finish();
  }

  endQuestion() {
    const r = this.round;
    const before = this.phase;
    super.endQuestion();
    if (!r || !['countdown', 'question'].includes(before) || this.phase !== 'reveal') return;
    const me = [...this.players.values()][0];
    const res = this.reveal.results.find((x) => x.playerId === me?.id);
    this.log[this.roundIndex] = {
      row: answerRow({ round: r, roundIndex: this.roundIndex, mode: 'mix', answered: !!res, result: res }),
      kind: r.kind,
      mode: r.mixPart ?? r.kind,
      input: r.input ?? (r.kind === 'qcm' ? 'choice' : r.kind === 'estimation' ? 'text' : null),
      game: r.title ?? null,
      answered: !!res,
      correct: res ? !!res.correct : false,
      exact: !!res?.exact,
      points: res?.points ?? 0,
      timeMs: res?.timeMs ?? null,
      durationMs: r.durationMs,
    };
    this.broadcast(); // la case de cette manche, dans la correction
    this.save(false);
  }

  cells() {
    return this.challenge.rounds.map((_, i) => (this.log[i] ? cellOf(this.log[i]) : i <= this.roundIndex ? 'miss' : 'none'));
  }

  score() {
    const p = [...this.players.values()][0];
    if (p) this.lastScore = p.score;
    return this.lastScore ?? 0;
  }

  /** Ligne du classement : créée au départ (une seule tentative), mise à jour après chaque manche. */
  async save(final) {
    const user = this.user;
    if (!user) return;
    const day = this.challenge.day;
    const cells = this.cells();
    const row = {
      id: `${day}:${user.id}`,
      day,
      user_id: user.id,
      name: user.nickname || user.name || this.playerName || 'Joueur',
      avatar_url: user.avatar ?? null,
      score: this.score(),
      grid: gridText(cells.map((c) => (c === 'none' ? 'miss' : c))),
      correct: this.log.filter((x) => x && x.correct).length,
      rounds: this.challenge.rounds.length,
      streak: this.streak,
      finished: final,
      started_at: this.startedAt,
      ...(final ? { finished_at: new Date().toISOString() } : {}),
    };
    this.saved = row;
    this.queue = (this.queue ?? Promise.resolve()).then(() => store.upsert('daily_results', row)).catch((err) => console.error('[défi] résultat :', err.message));
    return this.queue;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    // Manches non jouées (arrêt en cours) : comptées comme ratées
    super.finish();
    this.save(true).then(async () => {
      await this.sendStats();
      this.leaderboard = await this.dailyApi.leaderboard(this.challenge.day);
      this.broadcast();
    });
  }

  /** Les parties entre amis envoient leurs stats dans Room.finish : pas pour le défi (source 'daily' ici). */
  recordStats() {}

  sendStats() {
    const user = this.user;
    if (!user || this.statsSent) return;
    this.statsSent = true;
    const answers = this.log.filter(Boolean).map((x) => x.row);
    if (!answers.length) return;
    return recordStats({ userId: user.id, source: 'daily', sessionId: this.challenge.day, mode: 'daily', score: this.score(), rank: null, players: 1, won: false, answers });
  }

  /** Le joueur ferme le défi en cours : il compte comme terminé (une seule tentative). */
  destroy() {
    if (!this.done && this.roundIndex >= 0) {
      this.done = true;
      this.save(true);
      this.sendStats();
    }
    super.destroy();
  }

  view(pid) {
    const v = super.view(pid);
    const cells = this.cells();
    return {
      ...v,
      daily: {
        day: this.challenge.day,
        number: this.challenge.number,
        cells,
        grid: gridText(cells.filter((c) => c !== 'none')),
        account: !!this.user,
        streak: this.streak,
        correct: this.log.filter((x) => x && x.correct).length,
        rounds: this.challenge.rounds.length,
        nextAt: nextDayAt(),
        leaderboard: this.phase === 'end' ? this.leaderboard : null,
        me: this.user?.id ?? null,
      },
    };
  }
}

/** Démarre la partie du jour d'un joueur (refusée à un compte qui l'a déjà jouée). */
export async function startDaily(manager, socket, name, daily) {
  const user = socket.data.user ?? null;
  const challenge = await daily.challenge();
  if (user) {
    // Deux onglets lancés au même instant : un seul départ
    if (daily.starting.has(user.id)) throw new Error('Défi déjà en cours de lancement');
    daily.starting.add(user.id);
    try {
      return await openDaily(manager, socket, name, daily, challenge, user);
    } finally {
      daily.starting.delete(user.id);
    }
  }
  return openDaily(manager, socket, name, daily, challenge, null);
}

async function openDaily(manager, socket, name, daily, challenge, user) {
  if (user) {
    const mine = await daily.result(challenge.day, user.id);
    if (mine) return { already: true, played: publicResult(mine) };
  }
  manager.leave(socket);
  let code;
  do code = `J${crypto.randomBytes(6).toString('hex').toUpperCase()}`; while (manager.rooms.has(code));
  const room = new DailyRoom(manager.io, code, challenge, daily);
  manager.rooms.set(code, room);
  const p = room.addPlayer(name, socket);
  room.owner = user;
  room.playerName = p.name;
  if (user) {
    const prev = await daily.result(previousDay(challenge.day), user.id);
    room.streak = (prev?.streak ?? 0) + 1;
    await room.save(false); // la tentative compte dès maintenant
  }
  room.start();
  return { ok: true, code: room.code, token: p.token, playerId: p.id };
}
