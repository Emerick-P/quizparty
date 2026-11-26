import { store as defaultStore } from './store.js';
import { contentRows } from './content-sync.js';
import { MODES } from './games/index.js';

/**
 * Stats des joueurs connectés (comptes Supabase).
 *
 * - Pendant la partie : rien n'est écrit. Chaque réponse est notée en mémoire (answerRow) sur le joueur.
 * - À la fin d'une partie allée jusqu'au bout : une ligne game_results par joueur connecté et une ligne
 *   answers par manche, envoyées en tâche de fond (recordGame). Le temps réel n'attend jamais la base.
 * - Le défi du jour écrit dans les mêmes tables (source 'daily'), ses réponses comptent dans les stats.
 * - Lecture : fonction SQL player_stats (calcul dans Postgres) ; sans Supabase (PC, tests), même calcul
 *   en JavaScript sur les fichiers locaux (computeStats).
 *
 * Tables et fonction : voir supabase/schema.sql.
 */

// ---- identifiant du contenu (même id que la table content), pour la future difficulté calculée
let contentIndex = null;
function contentIdOf(r, mode) {
  if (r.slug && r.kind === 'cover') return `covers:${r.slug}`;
  if (r.soundId != null) return `sounds:${r.soundId}`;
  if (!contentIndex) {
    contentIndex = new Map();
    try {
      for (const row of contentRows()) if (row.prompt) contentIndex.set(`${row.mode}|${row.prompt}`, row.id);
    } catch {}
  }
  const text = r.pitch ?? r.emojis ?? r.prompt;
  return (text && contentIndex.get(`${mode}|${text}`)) ?? null;
}

const INPUT_OF_KIND = { qcm: 'choice', typed: 'text', crossword: 'text' };

/** Ligne de réponse d'un joueur pour une manche (sans user_id / session : ajoutés à l'envoi). */
export function answerRow({ round, roundIndex, mode, result, answered }) {
  const m = round.mixPart ?? mode;
  return {
    roundIndex,
    mode: m,
    kind: round.kind,
    contentId: contentIdOf(round, m),
    game: round.title ?? null,
    input: round.input ?? INPUT_OF_KIND[round.kind] ?? null,
    answered: !!answered,
    correct: result?.self ? null : !!result?.correct, // question sur soi-même (Ta bande) : ne compte pas
    points: result?.points ?? 0,
    timeMs: answered && Number.isFinite(result?.timeMs) ? Math.round(result.timeMs) : null,
  };
}

export function createStats(store = defaultStore) {
  const enabled = () => store.name === 'supabase' || process.env.STATS_LOCAL === '1';

  /**
   * Enregistre une partie finie d'un joueur connecté. Ne lève jamais : une base indisponible
   * ne doit pas gêner la partie (l'erreur est seulement écrite dans les logs).
   */
  async function recordGame({ userId, source = 'party', sessionId, mode, score = 0, rank = null, players = 1, won = false, answers = [] }) {
    if (!userId || !enabled()) return null;
    try {
      const game = await store.insert('game_results', {
        user_id: userId,
        source,
        session_id: sessionId,
        mode,
        score,
        rank,
        players,
        won,
        rounds: answers.length,
        correct: answers.filter((a) => a.correct).length,
      });
      await store.insertMany('answers', answers.map((a) => ({
        game_id: game.id,
        user_id: userId,
        source,
        session_id: sessionId,
        round_index: a.roundIndex ?? null,
        mode: a.mode ?? mode,
        kind: a.kind ?? null,
        content_id: a.contentId ?? null,
        game: a.game ?? null,
        input: a.input ?? null,
        answered: !!a.answered,
        correct: a.correct ?? null,
        points: a.points ?? 0,
        time_ms: a.timeMs ?? null,
      })));
      return game;
    } catch (err) {
      console.error('[stats] enregistrement :', err.message);
      return null;
    }
  }

  /** Réponses du défi du jour sans résumé de partie (le fil du défi a sa propre table daily_results). */
  async function insertAnswers(rows) {
    if (!enabled() || !rows.length) return;
    await store.insertMany('answers', rows);
  }

  /** Stats d'un compte (voir computeStats pour la forme). */
  async function statsOf(userId) {
    if (!userId) return null;
    if (store.name === 'supabase') {
      try {
        return normalize(await store.rpc('player_stats', { uid: userId }));
      } catch (err) {
        console.error('[stats] lecture :', err.message);
        throw new Error('Stats indisponibles pour le moment, réessaie plus tard');
      }
    }
    if (!store.where) return null;
    const games = await store.where('game_results', (g) => g.user_id === userId);
    const answers = await store.where('answers', (a) => a.user_id === userId);
    return computeStats(games, answers);
  }

  return { recordGame, insertAnswers, statsOf, get enabled() { return enabled(); } };
}

/** Un jeu ne peut pas être à la fois « bien reconnu » et « qui résiste » : on le garde du côté où il pèse le plus. */
function normalize(s) {
  if (!s) return s;
  for (const m of s.modes ?? []) m.name = MODES[m.mode]?.name ?? m.mode;
  const best = new Set((s.best ?? []).map((x) => x.game));
  s.worst = (s.worst ?? []).filter((x) => !best.has(x.game) || x.n - x.good > x.good);
  s.best = (s.best ?? []).filter((x) => !s.worst.some((w) => w.game === x.game));
  return s;
}

/** Même calcul que la fonction SQL player_stats (utilisé sans Supabase et dans les tests). */
export function computeStats(games, answers) {
  const party = games.filter((g) => g.source === 'party');
  const order = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || (a.id > b.id ? 1 : -1);
  const scored = answers.filter((a) => a.correct != null).sort(order);
  const group = (key) => {
    const m = new Map();
    for (const a of scored) {
      const k = a[key];
      if (k == null) continue;
      const x = m.get(k) ?? { [key]: k, n: 0, good: 0 };
      x.n++;
      if (a.correct) x.good++;
      m.set(k, x);
    }
    return [...m.values()];
  };
  const gamesList = group('game');
  let streak = 0;
  let run = 0;
  for (const a of scored) {
    run = a.correct ? run + 1 : 0;
    streak = Math.max(streak, run);
  }
  const fast = scored.filter((a) => a.correct && a.time_ms > 0).sort((a, b) => a.time_ms - b.time_ms)[0];
  return normalize({
    games: party.length,
    wins: party.filter((g) => g.won).length,
    podiums: party.filter((g) => g.rank != null && g.rank <= 3 && g.players >= 2).length,
    bestScore: party.length ? Math.max(...party.map((g) => g.score)) : null,
    daily: new Set(answers.filter((a) => a.source === 'daily').map((a) => a.session_id)).size,
    answers: scored.length,
    correct: scored.filter((a) => a.correct).length,
    modes: group('mode').sort((a, b) => b.n - a.n),
    best: gamesList.filter((x) => x.good > 0).sort((a, b) => b.good - a.good || b.good / b.n - a.good / a.n || a.game.localeCompare(b.game)).slice(0, 5),
    worst: gamesList.filter((x) => x.n - x.good > 0).sort((a, b) => (b.n - b.good) - (a.n - a.good) || a.good / a.n - b.good / b.n || a.game.localeCompare(b.game)).slice(0, 3),
    fastest: fast ? { ms: fast.time_ms, game: fast.game ?? null, mode: fast.mode } : null,
    streak,
  });
}

export const stats = createStats();
