import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cote des joueurs (type Glicko-2), calculée surtout contre la cote des QUESTIONS.
 *
 * - Chaque question a sa propre cote (sa difficulté). Répondre juste à une question bien cotée rapporte
 *   beaucoup, rater une question facile coûte. Ça marche donc même en jouant seul (Défi du jour, défis).
 * - Petit bonus contre les autres joueurs connectés d'une partie (classement final), poids faible.
 * - Le hasard est pris en compte : en QCM à 4 choix, on a 25 % de chances de tomber juste sans savoir.
 * - Seule la première fois qu'un joueur voit une question compte (sinon on gagne en mémorisant).
 * - La vitesse ne compte pas : seulement savoir ou non. Estimation : résultat partiel selon l'écart.
 * - Absence : l'incertitude (rd) grandit chaque jour, la note ne baisse pas.
 * - Placement : la cote n'est « affichable » qu'après PLACEMENT réponses comptées (placed).
 * - Saisons mensuelles (heure de Paris) : une ligne par saison et par joueur ; au changement de mois,
 *   léger retour vers la moyenne et un peu plus d'incertitude. L'historique des saisons reste en base.
 * - Cote de départ des questions : note 1 à 5 estimée à l'avance (server/data/difficulty.json),
 *   a priori à forte incertitude ; les réponses des joueurs prennent vite le dessus.
 * - Paliers (Bronze, Argent…) : pas encore, mais tierOf() est le seul endroit à remplir.
 *
 * Tout passe par une file unique (une seule instance) : pas de mise à jour concurrente d'une même ligne.
 * Tables : player_ratings, question_ratings, rating_events (voir supabase/schema.sql).
 */

export const RATING = {
  start: 1500, // cote d'un nouveau joueur et d'une question moyenne
  rd: 350, // incertitude de départ d'un joueur
  vol: 0.06, // volatilité de départ
  tau: 0.5, // contrainte d'évolution de la volatilité (Glicko-2)
  minRd: 45,
  maxRd: 350,
  placement: 30, // réponses comptées avant d'afficher la cote
  question: { rd: 160, minRd: 35, vol: 0.03, step: 150 }, // a priori : note 1 à 5 → 1200 à 1800
  weights: { party: 1, live: 1, daily: 0.5, challenge: 0.5 }, // poids des réponses selon la source
  versus: 0.12, // poids d'un duel contre un autre joueur de la partie
  versusMax: 0.6, // poids total des duels dans une partie
  minAnsweredShare: 0.5, // un joueur qui a répondu à moins de la moitié des manches (absent) : partie ignorée
  season: { keep: 0.8, rd: 110 }, // reset léger au changement de saison
};

/** Modes dont les questions ont une cote (Ta bande et les mots croisés n'en ont pas). */
export const RATED_MODES = new Set(['quiz', 'vraifaux', 'estimation', 'covers', 'pitch', 'emoji', 'sounds']);

const SCALE = 173.7178;
const DAY = 86_400_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- clé stable d'une question (ne bouge pas si on ajoute ou retire d'autres questions)
const norm = (t) => String(t).normalize('NFC').trim().replace(/\s+/g, ' ');
export function questionKey(mode, { slug, soundId, text } = {}) {
  if (!RATED_MODES.has(mode)) return null;
  if (mode === 'covers') return slug ? `covers:${slug}` : null;
  if (mode === 'sounds') return soundId != null ? `sounds:${soundId}` : null;
  if (!text) return null;
  return `${mode}:${crypto.createHash('sha1').update(norm(text)).digest('hex').slice(0, 12)}`;
}

/** Clé d'une manche jouée. */
export function roundKey(round, mode) {
  return questionKey(round.mixPart ?? mode, { slug: round.kind === 'cover' ? round.slug : null, soundId: round.soundId, text: round.pitch ?? round.emojis ?? round.prompt });
}

/** Part de hasard : 1/nombre de choix quand on répond par propositions, 0 en saisie libre. */
export function guessOf(round) {
  const n = round.choices?.length;
  const typed = round.input === 'text' || round.kind === 'estimation' || round.kind === 'typed';
  return !typed && n >= 2 ? 1 / n : 0;
}

/** Résultat entre 0 et 1 (estimation : selon l'écart, 0 à partir de 50 % ou 25 ans d'écart). */
export function outcomeOf(round, result, answered) {
  if (!answered || !result) return 0;
  if (round.kind === 'estimation' && Number.isFinite(result.error)) return result.exact ? 1 : Math.max(0, 1 - result.error / 0.5);
  return result.correct ? 1 : 0;
}

// ---- a priori des questions
let priors = null;
export function priorOf(key) {
  if (!priors) {
    try { priors = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'data', 'difficulty.json'), 'utf8')).levels ?? {}; } catch { priors = {}; }
  }
  const lvl = priors[key];
  return Number.isFinite(lvl) ? Math.min(5, Math.max(1, lvl)) : 3;
}
export function questionStart(key) {
  const prior = priorOf(key);
  return { id: key, mode: key.split(':')[0], rating: RATING.start + (prior - 3) * RATING.question.step, rd: RATING.question.rd, n: 0, score: 0, prior };
}

// ---- saisons
const monthFmt = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' });
export const seasonOf = (t = Date.now()) => monthFmt.format(new Date(t)).slice(0, 7); // AAAA-MM

/** Palier d'une cote : à définir avec le client (Bronze, Argent…). Vide pour l'instant. */
export function tierOf(/* rating */) {
  return null;
}

/** Ce qu'on peut montrer d'une ligne de cote. Avant le placement : pas de nombre. */
export function publicRating(row, now = Date.now()) {
  if (!row) return { placed: false, rating: null, progress: 0, need: RATING.placement };
  const total = row.answers_total ?? 0;
  const placed = total >= RATING.placement;
  const rd = Math.round(inflate(row.rd, row.vol, row.last_at, now));
  return {
    placed,
    rating: placed ? Math.round(row.rating) : null,
    rd: placed ? rd : null,
    tier: placed ? tierOf(row.rating) : null,
    season: row.season,
    progress: Math.min(total, RATING.placement),
    need: RATING.placement,
  };
}

// ---- Glicko-2
const gOf = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const logistic = (x) => 1 / (1 + Math.exp(-x));

/** Incertitude après des jours d'absence (Glicko-2 : une période = un jour). */
function inflate(rd, vol, lastAt, now) {
  const days = lastAt ? Math.max(0, Math.floor((now - Date.parse(lastAt)) / DAY)) : 0;
  const phi = rd / SCALE;
  return Math.min(RATING.maxRd, Math.sqrt(phi * phi + days * vol * vol) * SCALE);
}

/**
 * Une observation : adversaire (cote, rd), résultat s ∈ [0,1], part de hasard c, poids w.
 * Probabilité de réussir : E = c + (1 − c)·σ(g(φj)(μ − μj)). Avec c = 0, c'est le Glicko-2 standard.
 * Renvoie les termes de la vraisemblance de Bernoulli : information et gradient.
 */
function terms(mu, { mu: muJ, phi: phiJ, s, c = 0, w = 1 }) {
  const g = gOf(phiJ);
  const e0 = logistic(g * (mu - muJ));
  const e = c + (1 - c) * e0;
  const de = (1 - c) * g * e0 * (1 - e0); // dE/dμ
  const ee = Math.max(e * (1 - e), 1e-9);
  return { info: (w * de * de) / ee, grad: (w * de * (s - e)) / ee, e };
}

/** Mise à jour Glicko-2 d'une cote contre une liste d'observations (une période). */
export function glicko({ rating, rd, vol }, obs, { tau = RATING.tau, fixedVol = false } = {}) {
  const mu = (rating - RATING.start) / SCALE;
  const phi = rd / SCALE;
  const opp = obs.map((o) => ({ ...o, mu: (o.rating - RATING.start) / SCALE, phi: o.rd / SCALE }));
  let info = 0;
  let grad = 0;
  for (const o of opp) {
    const t = terms(mu, o);
    info += t.info;
    grad += t.grad;
  }
  if (info <= 0) return { rating, rd, vol };
  const v = 1 / info;
  const delta = v * grad;
  let sigma = vol;
  if (!fixedVol) {
    // Volatilité : méthode d'Illinois (article de Glickman, étape 5)
    const a = Math.log(vol * vol);
    const f = (x) => {
      const ex = Math.exp(x);
      return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau);
    };
    let A = a;
    let B;
    if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
    else {
      let k = 1;
      while (f(a - k * tau) < 0 && k < 50) k++;
      B = a - k * tau;
    }
    let fA = f(A);
    let fB = f(B);
    for (let i = 0; i < 60 && Math.abs(B - A) > 1e-6; i++) {
      const C = A + ((A - B) * fA) / (fB - fA);
      const fC = f(C);
      if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
      B = C;
      fB = fC;
    }
    sigma = Math.exp(A / 2);
  }
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * grad;
  return { rating: RATING.start + muNew * SCALE, rd: phiNew * SCALE, vol: sigma };
}

/** Score d'un joueur contre un autre à la fin d'une partie : 1 devant, 0,5 à égalité, 0 derrière. */
export const versusScore = (me, other) => (me.rank < other.rank ? 1 : me.rank > other.rank ? 0 : 0.5);

export function createRatings(store) {
  let queue = Promise.resolve();
  const enabled = () => store.name === 'supabase' || process.env.STATS_LOCAL === '1';
  const serial = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };

  /** Ligne de la saison en cours (créée depuis la saison précédente avec un reset léger, ou neuve). */
  async function currentRow(userId, now) {
    const season = seasonOf(now);
    const id = `${season}:${userId}`;
    const row = await store.get('player_ratings', id);
    if (row) return row;
    const [last] = await store.query('player_ratings', { eq: { user_id: userId }, order: 'season.desc', limit: 1 });
    const base = { id, season, user_id: userId, answers: 0, games: 0, peak: null, created_at: new Date(now).toISOString() };
    if (!last) return { ...base, rating: RATING.start, rd: RATING.rd, vol: RATING.vol, answers_total: 0, last_at: null };
    const rd = inflate(last.rd, last.vol, last.last_at, now);
    return {
      ...base,
      rating: RATING.start + RATING.season.keep * (last.rating - RATING.start),
      rd: Math.min(RATING.maxRd, Math.max(rd, RATING.season.rd)),
      vol: last.vol,
      answers_total: last.answers_total ?? 0,
      last_at: new Date(now).toISOString(), // l'absence avant la saison est déjà comptée ci-dessus
    };
  }

  /** Questions déjà vues par ce joueur (avant cette partie). */
  async function seenKeys(userId, keys) {
    if (!keys.length) return new Set();
    if (store.where) {
      const rows = await store.where('answers', (a) => a.user_id === userId && keys.includes(a.question_key));
      return new Set(rows.map((a) => a.question_key));
    }
    const rows = await store.query('answers', { eq: { user_id: userId }, inList: { question_key: keys }, select: 'question_key', limit: 1000 });
    return new Set(rows.map((a) => a.question_key));
  }

  /**
   * Met à jour la cote d'un joueur et celle des questions après une partie finie.
   * answers : lignes answerRow (questionKey, outcome, guess, answered) ; versus : [{ userId, score }].
   * À appeler AVANT d'enregistrer les réponses de la partie (sinon elles comptent comme « déjà vues »).
   * Renvoie { before, after, counted, public } ou null si rien n'a compté.
   */
  function recordGame({ userId, source = 'party', sessionId = null, answers = [], versus = [], now = Date.now() }) {
    if (!userId || !enabled()) return Promise.resolve(null);
    return serial(async () => {
      const rated = answers.filter((a) => a.questionKey);
      if (!rated.length) return null;
      if (answers.filter((a) => a.answered).length < answers.length * RATING.minAnsweredShare) return null;
      const keys = [...new Set(rated.map((a) => a.questionKey))];
      const seen = await seenKeys(userId, keys);
      const fresh = rated.filter((a) => !seen.has(a.questionKey));
      const row = await currentRow(userId, now);
      const rd0 = inflate(row.rd, row.vol, row.last_at, now);
      const player = { rating: row.rating, rd: rd0, vol: row.vol };

      // Cotes des questions (a priori si jamais jouées)
      const qRows = new Map(fresh.length ? (await store.query('question_ratings', { inList: { id: fresh.map((a) => a.questionKey) }, limit: 1000 })).map((q) => [q.id, q]) : []);
      const qOf = (k) => qRows.get(k) ?? questionStart(k);

      const w = RATING.weights[source] ?? 0.5;
      const obs = fresh.map((a) => {
        const q = qOf(a.questionKey);
        return { rating: q.rating, rd: q.rd, s: a.outcome ?? (a.correct ? 1 : 0), c: a.guess ?? 0, w };
      });
      if (versus.length) {
        const others = await Promise.all(versus.map(async (o) => ({ o, r: await store.get('player_ratings', `${seasonOf(now)}:${o.userId}`) })));
        const each = Math.min(RATING.versus, RATING.versusMax / versus.length);
        for (const { o, r } of others) obs.push({ rating: r?.rating ?? RATING.start, rd: r ? inflate(r.rd, r.vol, r.last_at, now) : RATING.rd, s: o.score, w: each });
      }
      if (!obs.length) return null;

      const next = glicko(player, obs);
      next.rd = Math.max(RATING.minRd, Math.min(RATING.maxRd, next.rd));
      const at = new Date(now).toISOString();
      const before = publicRating(row, now);
      const updated = {
        ...row,
        rating: next.rating,
        rd: next.rd,
        vol: next.vol,
        answers: (row.answers ?? 0) + fresh.length,
        answers_total: (row.answers_total ?? 0) + fresh.length,
        games: (row.games ?? 0) + 1,
        last_at: at,
        updated_at: at,
      };
      const placedNow = updated.answers_total >= RATING.placement;
      updated.peak = placedNow ? Math.max(row.peak ?? -Infinity, next.rating) : row.peak ?? null;
      await store.upsert('player_ratings', updated);

      // Chaque question bouge contre la cote du joueur d'avant la partie (résultat inversé).
      const qUpdates = fresh.map((a) => {
        const q = qOf(a.questionKey);
        const s = a.outcome ?? (a.correct ? 1 : 0);
        const c = a.guess ?? 0;
        // Du point de vue de la question : P(elle « gagne ») = 1 − E, ce qui revient à la formule avec μ inversé.
        const n = glicko({ rating: 2 * RATING.start - q.rating, rd: q.rd, vol: RATING.question.vol }, [{ rating: 2 * RATING.start - player.rating, rd: player.rd, s, c }], { fixedVol: true });
        return { id: q.id, mode: q.mode, prior: q.prior, rating: 2 * RATING.start - n.rating, rd: Math.max(RATING.question.minRd, n.rd), n: (q.n ?? 0) + 1, score: (q.score ?? 0) + s, updated_at: at };
      });
      if (qUpdates.length) await store.upsertMany('question_ratings', qUpdates);

      const after = publicRating(updated, now);
      await store.insert('rating_events', {
        user_id: userId,
        season: updated.season,
        source,
        session_id: sessionId,
        rating_before: row.rating,
        rating_after: updated.rating,
        rd_after: updated.rd,
        counted: fresh.length,
      });
      return { before, after, counted: fresh.length, delta: before.placed && after.placed ? after.rating - before.rating : null };
    });
  }

  /** Cote affichable d'un compte (saison en cours, avec le reset de saison si besoin). */
  async function ratingOf(userId, now = Date.now()) {
    if (!userId || !enabled()) return null;
    const row = await store.get('player_ratings', `${seasonOf(now)}:${userId}`)
      ?? (await store.query('player_ratings', { eq: { user_id: userId }, order: 'season.desc', limit: 1 }))[0];
    if (!row) return publicRating(null);
    return publicRating(row.season === seasonOf(now) ? row : await currentRow(userId, now), now);
  }

  /**
   * Classement de la saison en cours : joueurs placés seulement (invités sans compte donc absents).
   * Un joueur qui n'a pas encore joué ce mois-ci n'a pas encore de ligne : il apparaît à sa 1re partie.
   * Renvoie { season, list } ; chaque entrée : userId, name, avatar, look, rating, games, peak.
   */
  async function board(limit = 100, now = Date.now()) {
    const season = seasonOf(now);
    if (!enabled()) return { season, list: [] };
    const rows = await store.query('player_ratings', { eq: { season }, gte: { answers_total: RATING.placement }, order: 'rating.desc', limit });
    const ids = rows.map((r) => r.user_id);
    const profiles = ids.length ? await store.query('profiles', { inList: { id: ids }, limit: ids.length }).catch(() => []) : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const list = rows.map((r) => {
      const p = byId.get(r.user_id);
      return {
        userId: r.user_id,
        name: p?.nickname || p?.name || 'Joueur',
        avatar: p?.avatar_url ?? null,
        look: p?.avatar_look ?? null,
        rating: Math.round(r.rating),
        games: r.games,
        peak: r.peak != null ? Math.round(r.peak) : null,
      };
    });
    return { season, list };
  }

  return { recordGame, ratingOf, board, get enabled() { return enabled(); } };
}
