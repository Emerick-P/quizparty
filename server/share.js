/**
 * Partage : aperçus des liens (balises Open Graph posées dans la page selon l'adresse) et images dessinées
 * à la demande (share-card.js). Les applis de discussion ne lancent pas de JavaScript : tout vient du serveur.
 *
 * Un résultat du Défi du jour ou d'un direct tient dans un jeton signé, porté par le lien (?defi=… ou ?r=…) :
 * rien à enregistrer, et on ne peut pas fabriquer un faux score. La clé vient de la clé Supabase ; sans elle
 * (en local), elle change à chaque démarrage et les anciens liens retombent sur l'aperçu général.
 *
 * Les défis entre potes n'ont jamais de score dans leur aperçu : le classement reste caché tant qu'on n'a pas joué.
 */
import crypto from 'node:crypto';
import { APP_NAME } from './brand.js';
import { dayKey } from './daily.js';
import { drawable, inviteCard, homeCard, scoreCard, storyCard, toPng } from './share-card.js';

const CACHE_MAX = 100; // images gardées en mémoire
const LOOKUP_MS = 1500; // la page ne doit jamais attendre la base plus longtemps
const MODE_CODES = { quiz: 'q', vraifaux: 'v', estimation: 'e', covers: 'c', pitch: 'p', emoji: 'j', sounds: 's', bande: 'b', crossword: 'm' };
const KIND_MODES = { qcm: 'quiz', typed: 'quiz', cover: 'covers', sound: 'sounds' };
const CODE_MODES = Object.fromEntries(Object.entries(MODE_CODES).map(([m, c]) => [c, m]));
const CELL_CODES = { fast: 'f', slow: 's', miss: 'm', none: 'm' };
const CODE_CELLS = { f: 'fast', s: 'slow', m: 'miss' };
const GRID_CELLS = { '🟩': 'fast', '🟨': 'slow', '🟥': 'miss' };

const secret = crypto.createHmac('sha256', process.env.SUPABASE_SECRET_KEY || crypto.randomBytes(32)).update('partage').digest();
const sign = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64url').slice(0, 12);

/** Mode d'une manche, pour son icône. */
export const modeOf = (round) => round?.mixPart ?? KIND_MODES[round?.kind] ?? round?.kind ?? 'quiz';
export const cellsOfGrid = (grid) => [...String(grid || '')].map((c) => GRID_CELLS[c] ?? 'miss');

/**
 * Jeton d'un résultat. type : 'jour' (id = numéro du défi) ou 'direct' (id = nom, at = heure de départ en ms).
 * cells : 'fast' | 'slow' | 'miss' par manche ; modes : le mode de chaque manche.
 */
export function scoreToken({ type, id, at = 0, score, correct, cells, modes, name }) {
  const data = [type === 'direct' ? 1 : 0, id, Math.round(at / 60000), Math.max(0, Math.round(score || 0)), correct || 0,
    cells.map((c) => CELL_CODES[c] ?? 'm').join(''), cells.map((_, i) => MODE_CODES[modes[i]] ?? 'q').join(''), String(name || '').slice(0, 16)];
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}~${sign(body)}`;
}
export function readToken(token) {
  const [body, sig, extra] = String(token || '').split('~');
  if (!body || !sig || extra !== undefined || body.length > 400) return null;
  const good = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (given.length !== good.length || !crypto.timingSafeEqual(given, good)) return null;
  const [direct, id, min, score, correct, cells, modes, name] = JSON.parse(Buffer.from(body, 'base64url').toString());
  return {
    type: direct ? 'direct' : 'jour', id, at: min * 60000, score, correct, name,
    cells: [...cells].map((c) => CODE_CELLS[c]), modes: [...modes].map((c) => CODE_MODES[c]), rounds: cells.length,
  };
}

const parisWhen = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
const headingOf = (r) => (r.type === 'jour' ? `Défi du jour n°${r.id}` : `Direct ${r.id}, ${parisWhen.format(r.at)}`);
const points = (n) => `${new Intl.NumberFormat('fr-FR').format(n)} point${n > 1 ? 's' : ''}`;
const nameOr = (name, fallback) => (name && drawable(name) ? name : fallback);

const withTimeout = (p) => Promise.race([p, new Promise((resolve) => { setTimeout(resolve, LOOKUP_MS, null).unref(); })]).catch(() => null);

/**
 * Ce qu'un lien doit montrer : { id (nom de l'image), title, description, card (dessin de l'aperçu) }.
 * id : 'accueil', 'jour', 'salon-ABCD', 'defi-XK7P2Q' ou un jeton de résultat.
 */
async function describe(id, rooms) {
  const result = id.includes('~') ? readToken(id) : null;
  if (result) {
    const who = nameOr(result.name, '');
    const heading = headingOf(result);
    const found = `${result.correct} trouvée${result.correct > 1 ? 's' : ''} sur ${result.rounds}`;
    return {
      id,
      result,
      title: who ? `${who} a fait ${points(result.score)}` : `${points(result.score)} à battre`,
      description: `${heading} : ${found}. À toi de faire mieux.`,
      card: () => scoreCard({
        ...result,
        title: result.type === 'jour' ? ['Défi', `du jour n°${result.id}`] : ['Direct', result.id],
        lines: [who ? `${who} : ${found}` : found, 'Fais mieux !'],
      }),
    };
  }
  if (id === 'jour') {
    const number = await withTimeout(rooms.daily.number(dayKey()));
    return {
      id: number ? `jour-${number}` : 'jour',
      title: `Défi du jour${number ? ` n°${number}` : ''}`,
      description: 'Le même quiz jeu vidéo pour tout le monde, une seule tentative.',
      card: () => inviteCard({ title: ['Le défi', 'du jour'], lines: ['Le même quiz pour tous', 'Une seule tentative'], label: 'Aujourd’hui', value: number ? `n°${number}` : '?', code: false }),
    };
  }
  const daily = /^jour-(\d{1,6})$/.exec(id);
  if (daily) {
    return {
      id,
      card: () => inviteCard({ title: ['Le défi', 'du jour'], lines: ['Le même quiz pour tous', 'Une seule tentative'], label: 'Défi', value: `n°${daily[1]}`, code: false }),
    };
  }
  const room = /^salon-([A-Z]{4})$/.exec(id);
  if (room) {
    const r = rooms.rooms.get(room[1]);
    if (r) {
      const host = nameOr(r.players.get(r.hostId)?.name, '');
      return {
        id,
        title: host ? `${host} t’invite à jouer` : 'Rejoins la partie',
        description: `Salon ${r.code} : rejoins la partie depuis ton téléphone ou ton PC.`,
        card: () => inviteCard({ title: host ? [host, 't’invite'] : ['Rejoins', 'la partie'], lines: ['Quiz jeu vidéo en direct', 'Sur ton téléphone ou ton PC'], label: 'Code du salon', value: r.code }),
      };
    }
  }
  const challenge = /^defi-([A-Z0-9]{6})$/.exec(id);
  if (challenge) {
    const c = await withTimeout(rooms.challenges.get(challenge[1]));
    if (c) {
      const by = nameOr(c.ownerName, 'Un pote');
      const closed = Date.now() >= c.endsAt;
      const rules = `${c.rounds.length} questions, ${c.settings.duration} s chacune`;
      return {
        id,
        title: closed ? `Le défi de ${by}` : `${by} te lance un défi`,
        description: `${rules}, mode ${c.modeName}. ${closed ? 'Défi terminé : le classement est là.' : 'Une seule tentative.'}`,
        card: () => inviteCard({ title: closed ? ['Le défi', `de ${by}`] : [by, 'te défie'], lines: [rules, `Mode ${c.modeName}`], label: 'Code du défi', value: c.id }),
      };
    }
  }
  return {
    id: 'accueil',
    title: `${APP_NAME}, le quiz jeu vidéo entre amis`,
    description: 'Tout le monde joue en même temps, sur son téléphone ou son PC. Questions, jaquettes, emojis et plus.',
    card: () => homeCard({ lines: ['Le quiz jeu vidéo', 'entre amis, en direct'] }),
  };
}

/** L'image qui correspond à l'adresse ouverte. */
function idOfQuery(query) {
  const one = (k) => (typeof query[k] === 'string' ? query[k] : '');
  const token = one('r') || one('defi');
  if (token && readToken(token)) return token;
  if (query.defi !== undefined) return 'jour';
  if (one('c')) return `defi-${one('c').toUpperCase()}`;
  if (one('code')) return `salon-${one('code').toUpperCase()}`;
  return 'accueil';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Balises à poser dans <head> pour l'adresse demandée. origin : adresse publique du site. */
export async function previewTags(req, rooms, origin) {
  const p = await describe(idOfQuery(req.query), rooms);
  const image = `${origin}/partage/apercu/${encodeURIComponent(p.id)}.png`;
  const tags = [
    ['name', 'description', p.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', APP_NAME],
    ['property', 'og:locale', 'fr_FR'],
    ['property', 'og:title', p.title],
    ['property', 'og:description', p.description],
    ['property', 'og:url', `${origin}${req.originalUrl}`],
    ['property', 'og:image', image],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', p.title],
    ['name', 'twitter:card', 'summary_large_image'],
  ];
  return tags.map(([attr, key, value]) => `  <meta ${attr}="${key}" content="${esc(value)}">\n`).join('');
}

/** Images : /partage/apercu/<id>.png (lien) et /partage/story/<jeton>.png (score à partager). */
export function installShare(app, { rooms, siteOrigin }) {
  const cache = new Map(); // clé → Promise<PNG>
  const cached = (key, make) => {
    let p = cache.get(key);
    if (!p) {
      p = make();
      cache.set(key, p);
      p.catch(() => cache.delete(key));
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return p;
  };
  const send = async (res, key, make, maxAge) => {
    try {
      const png = await cached(key, make);
      res.set('Cache-Control', `public, max-age=${maxAge}`);
      res.type('image/png').send(png);
    } catch (err) {
      console.error('[partage]', err.message);
      res.sendStatus(500);
    }
  };
  app.get('/partage/apercu/:file', async (req, res) => {
    const file = String(req.params.file);
    if (!file.endsWith('.png') || file.length > 500) return res.sendStatus(404);
    const p = await describe(file.slice(0, -4), rooms).catch(() => null);
    if (!p) return res.sendStatus(404);
    // Salon et défi : le titre peut changer (nouvel hôte, défi terminé) ; l'image suit
    return send(res, `apercu:${p.id}:${p.title ?? ''}`, () => toPng(p.card()), 3600);
  });
  app.get('/partage/story/:file', (req, res) => {
    const file = String(req.params.file);
    const result = file.endsWith('.png') && file.length <= 500 ? readToken(file.slice(0, -4)) : null;
    if (!result) return res.sendStatus(404);
    const site = new URL(siteOrigin(req)).host;
    return send(res, `story:${site}:${file}`, () => toPng(storyCard({ ...result, heading: headingOf(result), site })), 86400);
  });
}
