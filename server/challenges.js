import crypto from 'node:crypto';
import { Room } from './room.js';
import { MODES, KINDS, MIX_PARTS, allowed, modeList } from './games/index.js';
import { store } from './store.js';
import { stats } from './stats.js';
import { DailyRoom, gridText } from './daily.js';

/**
 * Défis entre potes : un joueur connecté fige une série de questions et partage un lien (/?c=CODE).
 * Chacun le joue quand il veut, une seule fois, et tout le monde est au même classement (invités compris).
 *
 * - Même mécanique que le Défi du jour (DailyRoom : partie solo, chrono serveur, correction, grille 🟩🟨🟥),
 *   seuls la série de questions, les réglages et l'enregistrement changent.
 * - Une tentative par compte ; un invité est reconnu par un identifiant d'appareil gardé dans son navigateur
 *   (contournable en navigation privée : assumé, on joue entre potes).
 * - Un défi reste ouvert CHALLENGE_DAYS jours, puis seul son classement final reste visible.
 * - Modes réservés (sons…) : seulement si le créateur y a droit (rôle friend/admin), comme l'hôte d'un salon.
 * - Tables : challenges (le défi figé) et challenge_results (une ligne par joueur et par défi).
 *   Les ligues entre amis pourront regrouper des défis plus tard (une colonne sur challenges suffira).
 */
export const CHALLENGE_ROUNDS = [5, 10, 15];
export const CHALLENGE_DURATIONS = [10, 15, 20];
export const CHALLENGE_DAYS = 7;
export const CHALLENGE_DEFAULTS = { mode: 'mix', rounds: 10, duration: 15 };
// Pas de mots croisés (partie entière) ni de « Ta bande » (profils Steam d'un salon)
const EXCLUDED = new Set(['crossword', 'bande']);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I : lisible à voix haute
const CODE_LEN = 6;

const newCode = () => Array.from(crypto.randomBytes(CODE_LEN), (b) => ALPHABET[b % ALPHABET.length]).join('');
export const cleanCode = (raw) => String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
/** Joueur d'un défi : son compte, sinon l'appareil de l'invité (identifiant haché, jamais gardé en clair). */
export function playerKey(user, device) {
  if (user?.id) return `u:${user.id}`;
  const d = String(device ?? '');
  if (!/^[\w-]{16,64}$/.test(d)) return null;
  return `g:${crypto.createHash('sha256').update(d).digest('hex').slice(0, 24)}`;
}
/** Contexte des modes réservés : ouverts si le créateur y a droit (sans comptes, en local : ouverts). */
const ctxOf = (user) => ({ reserved: Room.accounts ? !!user?.reserved : true });
/** Modes proposés à la création. */
export const challengeModes = (user) => modeList(ctxOf(user)).filter((m) => !EXCLUDED.has(m.id) && !m.unavailable);

const publicResult = (r) => ({ score: r.score, grid: r.grid, correct: r.correct, rounds: r.rounds, finished: !!r.finished });

export class Challenges {
  constructor() {
    this.cache = new Map(); // code → Promise<défi | null>
    this.starting = new Set(); // joueurs en train de lancer un défi
  }

  /** Nouveau défi : manches tirées une fois pour toutes, gardées en base. */
  async create(user, raw = {}) {
    if (Room.accounts && !user) throw new Error('Connecte-toi pour créer un défi');
    const ctx = ctxOf(user);
    const mode = String(raw.mode ?? CHALLENGE_DEFAULTS.mode);
    const rounds = Number(raw.rounds ?? CHALLENGE_DEFAULTS.rounds);
    const duration = Number(raw.duration ?? CHALLENGE_DEFAULTS.duration);
    if (EXCLUDED.has(mode) || !allowed(mode, ctx) || MODES[mode].unavailable?.(ctx)) throw new Error('Mode indisponible pour un défi');
    if (!CHALLENGE_ROUNDS.includes(rounds)) throw new Error('Nombre de questions invalide');
    if (!CHALLENGE_DURATIONS.includes(duration)) throw new Error('Durée invalide');
    const mixParts = MIX_PARTS.filter((id) => !EXCLUDED.has(id) && allowed(id, ctx));
    const settings = { mode, rounds, duration, input: 'choice', level: 'easy', mixParts, mixInput: 'mixed' };
    const built = MODES[mode].build(rounds, new Set(), settings, ctx);
    if (!built.length) throw new Error('Défi indisponible pour le moment');
    const now = Date.now();
    const row = {
      owner_id: user?.id ?? null,
      owner_name: user ? user.nickname || user.name || 'Joueur' : String(raw.name || 'Joueur').slice(0, 16),
      mode,
      rounds: JSON.parse(JSON.stringify(built)),
      settings: { mode, rounds: built.length, duration },
      created_at: new Date(now).toISOString(),
      ends_at: new Date(now + CHALLENGE_DAYS * 86400_000).toISOString(),
    };
    for (let tries = 0; ; tries++) {
      row.id = newCode();
      try {
        await store.insert('challenges', row);
        break;
      } catch (err) {
        if (tries >= 4) throw new Error('Défi non enregistré, réessaie');
      }
    }
    const challenge = this.shape(row);
    this.cache.set(row.id, Promise.resolve(challenge));
    return challenge;
  }

  shape(row) {
    return {
      id: row.id,
      day: row.id, // DailyRoom range ses résultats par « jour » : ici, le code du défi
      ownerId: row.owner_id ?? null,
      ownerName: row.owner_name || 'Joueur',
      mode: row.mode,
      modeName: MODES[row.mode]?.name ?? row.mode,
      settings: row.settings ?? {},
      rounds: row.rounds.filter((r) => KINDS[r.kind]), // type de manche supprimé depuis : manche retirée
      createdAt: Date.parse(row.created_at) || Date.now(),
      endsAt: Date.parse(row.ends_at),
    };
  }

  /** Un défi par son code (null : inconnu). */
  get(code) {
    const id = cleanCode(code);
    if (id.length !== CODE_LEN) return Promise.resolve(null);
    if (!this.cache.has(id)) {
      const p = store.get('challenges', id).then((row) => (row?.rounds?.some((r) => KINDS[r.kind]) ? this.shape(row) : null)).catch((err) => {
        console.error('[défis] lecture :', err.message);
        this.cache.delete(id);
        return null;
      });
      this.cache.set(id, p);
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(id);
  }

  result(id, key) {
    if (!key) return Promise.resolve(null);
    return store.get('challenge_results', `${id}:${key}`).catch(() => null);
  }

  /** Le classement du défi (pseudo, score, grille). */
  async leaderboard(id, limit = 100) {
    const rows = await store.query('challenge_results', { eq: { challenge_id: id }, order: 'score.desc,started_at.asc', limit }).catch(() => []);
    return (rows ?? []).map((r) => ({ userId: r.player_key, name: r.name, avatar: r.avatar_url, guest: !r.user_id, score: r.score, grid: r.grid, finished: !!r.finished }));
  }

  /** Page d'un défi : réglages, mon résultat, classement (visible après avoir joué, ou une fois le défi clos). */
  async info(code, user, device) {
    const c = await this.get(code);
    if (!c) return { error: 'Défi introuvable' };
    const key = playerKey(user, device);
    const mine = await this.result(c.id, key);
    const closed = Date.now() >= c.endsAt;
    const board = await this.leaderboard(c.id);
    return {
      challenge: this.summary(c),
      closed,
      me: key,
      mine: user?.id && c.ownerId === user.id,
      played: mine ? publicResult(mine) : null,
      players: board.length,
      leaderboard: mine || closed ? board : null,
    };
  }

  summary(c) {
    return { id: c.id, by: c.ownerName, mode: c.mode, modeName: c.modeName, rounds: c.rounds.length, duration: c.settings.duration, endsAt: c.endsAt, createdAt: c.createdAt };
  }

  /** « Mes défis » d'un compte : ceux qu'il a créés et ceux qu'il a joués, les plus récents d'abord. */
  async list(user, device, codes = []) {
    const key = playerKey(user, device);
    const [own, played] = await Promise.all([
      user?.id ? store.query('challenges', { eq: { owner_id: user.id }, order: 'created_at.desc', limit: 30, select: 'id,owner_id,owner_name,mode,settings,created_at,ends_at' }).catch(() => []) : [],
      key ? store.query('challenge_results', { eq: { player_key: key }, order: 'started_at.desc', limit: 30 }).catch(() => []) : [],
    ]);
    const byId = new Map();
    for (const row of own ?? []) byId.set(row.id, { ...this.meta(row), mine: true });
    // Invité : les codes que son navigateur a gardés (défis ouverts sans les jouer)
    const ids = new Set([...(played ?? []).map((r) => r.challenge_id), ...codes.map(cleanCode)].filter((id) => id && !byId.has(id)));
    for (const id of [...ids].slice(0, 30)) {
      const c = await this.get(id);
      if (c) byId.set(id, { ...this.summary(c), mine: !!(user?.id && c.ownerId === user.id) });
    }
    for (const r of played ?? []) if (byId.has(r.challenge_id)) byId.get(r.challenge_id).played = publicResult(r);
    const list = [...byId.values()];
    await Promise.all(list.map(async (x) => {
      const board = await this.leaderboard(x.id);
      x.players = board.length;
      x.rank = x.played ? board.findIndex((b) => b.userId === key) + 1 || null : null;
      x.leader = board[0] ? { name: board[0].name, score: board[0].score } : null;
    }));
    return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  }

  meta(row) {
    return { id: row.id, by: row.owner_name || 'Joueur', mode: row.mode, modeName: MODES[row.mode]?.name ?? row.mode, rounds: row.settings?.rounds, duration: row.settings?.duration, endsAt: Date.parse(row.ends_at), createdAt: Date.parse(row.created_at) };
  }
}

/** Partie solo d'un défi : le moteur du Défi du jour, sur les manches du défi. */
export class ChallengeRoom extends DailyRoom {
  constructor(io, code, challenge, api, key) {
    super(io, code, challenge, api);
    this.isChallenge = true;
    this.key = key;
    this.settings = { ...this.settings, mode: challenge.mode, rounds: challenge.rounds.length, duration: challenge.settings.duration };
  }

  pause() { throw new Error('Pas de pause pendant un défi'); }
  updateSettings() { throw new Error('Les réglages du défi sont fixés par son créateur'); }

  async save(final) {
    const c = this.challenge;
    const user = this.user;
    const cells = this.cells();
    const row = {
      id: `${c.id}:${this.key}`,
      challenge_id: c.id,
      player_key: this.key,
      user_id: user?.id ?? null,
      name: user?.nickname || user?.name || this.playerName || 'Joueur',
      avatar_url: user?.avatar ?? null,
      score: this.score(),
      grid: gridText(cells.map((x) => (x === 'none' ? 'miss' : x))),
      correct: this.log.filter((x) => x && x.correct).length,
      rounds: c.rounds.length,
      finished: final,
      started_at: this.startedAt,
      ...(final ? { finished_at: new Date().toISOString() } : {}),
    };
    this.saved = row;
    this.queue = (this.queue ?? Promise.resolve()).then(() => store.upsert('challenge_results', row)).catch((err) => console.error('[défis] résultat :', err.message));
    return this.queue;
  }

  sendStats() {
    const user = this.user;
    if (!user || this.statsSent) return;
    this.statsSent = true;
    const answers = this.log.filter(Boolean).map((x) => x.row);
    if (!answers.length) return;
    return stats.recordGame({ userId: user.id, source: 'challenge', sessionId: this.challenge.id, mode: this.challenge.mode, score: this.score(), rank: null, players: 1, won: false, answers })
      .catch((err) => console.error('[défis] stats :', err.message));
  }

  view(pid) {
    const v = super.view(pid);
    const c = this.challenge;
    return { ...v, daily: { ...v.daily, nextAt: null, streak: 0, account: true, me: this.key, challenge: { id: c.id, by: c.ownerName, modeName: c.modeName, endsAt: c.endsAt } } };
  }
}

/** Lance la partie d'un joueur sur un défi (refusée s'il l'a déjà jouée ou si le défi est clos). */
export async function startChallenge(manager, socket, name, api, code, device) {
  const c = await api.get(code);
  if (!c) throw new Error('Défi introuvable');
  if (Date.now() >= c.endsAt) throw new Error('Ce défi est terminé');
  const user = socket.data.user ?? null;
  const key = playerKey(user, device);
  if (!key) throw new Error('Appareil non reconnu, recharge la page');
  const lock = `${c.id}:${key}`;
  if (api.starting.has(lock)) throw new Error('Défi déjà en cours de lancement');
  api.starting.add(lock);
  try {
    const mine = await api.result(c.id, key);
    if (mine) return { already: true, played: publicResult(mine) };
    manager.leave(socket);
    let code2;
    do code2 = `C${crypto.randomBytes(6).toString('hex').toUpperCase()}`; while (manager.rooms.has(code2));
    const room = new ChallengeRoom(manager.io, code2, c, api, key);
    manager.rooms.set(code2, room);
    const p = room.addPlayer(name, socket);
    room.owner = user;
    room.playerName = p.name;
    await room.save(false); // la tentative compte dès maintenant
    room.start();
    return { ok: true, code: room.code, token: p.token, playerId: p.id };
  } finally {
    api.starting.delete(lock);
  }
}
