import express from 'express';
import crypto from 'node:crypto';
import { store as defaultStore } from './store.js';
import { COVER_GAMES } from './data/cover-games.js';
import { EMOJI_PUZZLES } from './data/emojis.js';
import { RESERVED_MODES } from './games/index.js';

/**
 * Formulaire « Proposer » : les amis soumettent du contenu pour tous les modes (sauf mots croisés,
 * qui se remplissent avec les autres modes). Tout arrive avec le statut « pending » ; Claude vérifie,
 * intègre ce qui est juste dans server/data/… puis passe la soumission en accepted / rejected / doubt.
 *
 * Champs communs : mode, author (pseudo), game (jeu concerné), prompt (question, pitch, emojis…),
 * answer (bonne réponse), extra (champs propres au mode), source (facultative), fichier son.
 */

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n) : '');

const AUDIO_TYPES = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm' };
export const MAX_AUDIO = 3 * 1024 * 1024;

/**
 * Description de chaque mode pour le formulaire (le client construit les champs à partir d'ici).
 * need : champs obligatoires. file : 'audio'.
 */
export const SUBMIT_MODES = {
  quiz: { name: 'Quiz classique', hint: 'Une question à 4 choix sur le contenu d’un jeu (personnages, lieux, mécaniques…).', need: ['prompt', 'answer'], wrong: true },
  vraifaux: { name: 'Vrai ou faux', hint: 'Une affirmation, vraie ou fausse.', need: ['prompt', 'truth'] },
  estimation: { name: 'Estimation', hint: 'Une question dont la réponse est un nombre (record, compteur, durée, année…).', need: ['prompt', 'number'] },
  covers: { name: 'Jaquette pixelisée', hint: 'Un jeu dont la jaquette mériterait d’être devinée.', need: ['game'] },
  pitch: { name: 'Pitch mal expliqué', hint: 'Le jeu résumé de travers, absurde mais vrai, sans le nommer.', need: ['prompt', 'game'] },
  emoji: { name: 'Le jeu en emojis', hint: 'Le jeu raconté en quelques emojis.', need: ['prompt', 'game'] },
  sounds: { name: 'Quel jeu fait ce bruit ?', hint: 'Un son culte, court (quelques secondes), qui ne dit pas le nom du jeu.', need: ['file', 'game'], file: 'audio' },
};

/** Titres connus, pour l'autocomplétion du champ « Jeu ». */
export function knownGames() {
  const set = new Set();
  for (const g of COVER_GAMES) set.add(g.title);
  for (const e of EMOJI_PUZZLES) if (e.title) set.add(e.title);
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

function decodeFile(dataUrl) {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Fichier illisible, réessaie avec un autre.');
  const type = m[1].toLowerCase();
  const ext = AUDIO_TYPES[type];
  if (!ext) throw new Error('Son MP3, OGG, WAV ou M4A seulement.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_AUDIO) throw new Error(`Fichier trop lourd (${Math.ceil(MAX_AUDIO / 1048576)} Mo maximum).`);
  if (buf.length < 200) throw new Error('Fichier vide ou trop petit.');
  return { buf, type: type === 'audio/mp3' ? 'audio/mpeg' : type, ext };
}

/** Vérifie et normalise une soumission. Lève une Error au message lisible par le joueur. */
export function parseSubmission(body) {
  const mode = String(body?.mode || '');
  const def = SUBMIT_MODES[mode];
  if (!def) throw new Error('Choisis un mode de jeu.');
  const row = {
    mode,
    author: clip(body.author, 24) || null,
    game: clip(body.game, 120) || null,
    prompt: clip(body.prompt, 600) || null,
    answer: clip(body.answer, 200) || null,
    source: clip(body.source, 500) || null,
    extra: {},
  };
  if (def.wrong) {
    const wrong = (Array.isArray(body.wrong) ? body.wrong : []).map((w) => clip(w, 120)).filter(Boolean).slice(0, 3);
    if (wrong.length) row.extra.wrong = wrong;
  }
  if (mode === 'vraifaux') {
    if (body.truth !== true && body.truth !== false) throw new Error('Dis si c’est vrai ou faux.');
    row.answer = body.truth ? 'Vrai' : 'Faux';
  }
  if (mode === 'estimation') {
    const n = Number(String(body.number ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error('La réponse doit être un nombre.');
    row.answer = String(n);
    const unit = clip(body.unit, 40);
    if (unit) row.extra.unit = unit;
  }
  const info = clip(body.info, 400);
  if (info) row.extra.info = info;
  // Pour les modes « trouve le jeu », la réponse est le jeu
  if (['covers', 'pitch', 'emoji', 'sounds'].includes(mode)) row.answer = row.game;
  for (const f of def.need) {
    if (f === 'file') { if (!body.file) throw new Error('Ajoute un son.'); continue; }
    if (f === 'truth' || f === 'number') continue;
    if (!row[f]) throw new Error({ prompt: mode === 'emoji' ? 'Écris les emojis.' : mode === 'pitch' ? 'Écris le pitch.' : 'Écris la question.', answer: 'Écris la bonne réponse.', game: 'Indique le jeu.' }[f]);
  }
  if (mode === 'quiz' && row.extra.wrong?.some((w) => w.toLowerCase() === row.answer.toLowerCase())) throw new Error('Une mauvaise réponse est identique à la bonne.');
  const file = def.file && body.file ? decodeFile(body.file) : null;
  return { row, file };
}

/** Anti-abus simple : 40 soumissions par heure et par adresse IP. */
function limiter(max = 40, windowMs = 3600_000) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

/**
 * Modes réservés (sons : droits non acquis, voir RESERVED_MODES) : proposables
 * seulement par un compte au rôle friend/admin (jeton Supabase dans l'en-tête Authorization).
 * Sans comptes (local, tests sans Supabase), ouverts comme en jeu.
 */
async function reservedOk(req, auth) {
  if (!auth?.enabled) return true;
  const token = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1];
  return !!(token && (await auth.verify(token).catch(() => null))?.reserved);
}

export function installSubmissions(app, { store = defaultStore, auth = null } = {}) {
  const allow = limiter();
  app.get('/api/submit/options', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ok = await reservedOk(req, auth);
    const modes = Object.fromEntries(Object.entries(SUBMIT_MODES).filter(([id]) => ok || !RESERVED_MODES.includes(id)));
    res.json({ modes, games: knownGames(), maxAudio: MAX_AUDIO });
  });
  app.post('/api/submissions', express.json({ limit: '12mb' }), async (req, res) => {
    if (!allow(req.ip)) return res.status(429).json({ error: 'Beaucoup de propositions d’un coup ! Réessaie dans un moment.' });
    if (RESERVED_MODES.includes(req.body?.mode) && !(await reservedOk(req, auth))) {
      return res.status(403).json({ error: 'Ce mode n’est pas ouvert aux propositions avec ce compte.' });
    }
    let parsed;
    try {
      parsed = parseSubmission(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const { row, file } = parsed;
    try {
      const id = crypto.randomUUID();
      if (file) {
        row.file_path = await store.upload(`${row.mode}/${id}.${file.ext}`, file.buf, file.type);
        row.file_type = file.type;
      }
      const saved = await store.insert('submissions', { id, ...row, status: 'pending' });
      res.json({ ok: true, id: saved.id });
    } catch (err) {
      console.error('[soumissions]', err.message);
      res.status(503).json({ error: 'Impossible d’enregistrer pour l’instant. Réessaie dans une minute.' });
    }
  });
}
