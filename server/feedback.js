import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { store } from './store.js';

/**
 * Retours de l'hôte sur une question (bouton ⚑ Signaler pendant la partie).
 *
 * Une ligne JSON par retour dans data/feedback.jsonl (ou FEEDBACK_FILE) : ajout seulement, jamais réécrit,
 * donc rien n'est perdu si le serveur s'arrête. Le fichier est sur le disque du serveur : sur le PC
 * en local, et sur la VM une fois en ligne (il n'est pas suivi par git, une mise à jour ne l'efface pas).
 * En ligne (Render), le disque est effacé à chaque mise en veille : chaque retour est donc aussi copié dans
 * la table « reports » de Supabase quand SUPABASE_URL / SUPABASE_SECRET_KEY sont définis.
 * Lecture : npm run feedback.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FEEDBACK_FILE = process.env.FEEDBACK_FILE || path.join(ROOT, 'data', 'feedback.jsonl');

export const FEEDBACK_TYPES = {
  accept: 'Réponse à accepter en plus',
  wrong: 'La bonne réponse est fausse',
  remove: 'Question à supprimer',
  other: 'Autre',
};

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n) : '');

/** Copie de la manche sans l'état de jeu (réponses, timers), pour retrouver la question dans les banques. */
function snapshot(round) {
  const skip = new Set(['answers', 'misses', 'id', 'startsAt', 'endsAt', 'durationMs', 'banned']);
  const out = {};
  for (const [k, v] of Object.entries(round)) {
    if (skip.has(k) || v instanceof Map || v instanceof Set || typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}

export function makeFeedback({ type, accept, comment }, ctx) {
  if (!FEEDBACK_TYPES[type]) throw new Error('Choisis le type de retour');
  const entry = {
    id: crypto.randomBytes(4).toString('hex'),
    at: new Date().toISOString(),
    type,
    accept: clip(accept, 120) || null,
    comment: clip(comment, 1000) || null,
    mode: ctx.mode,
    kind: ctx.round.kind,
    phase: ctx.phase,
    room: ctx.room,
    by: ctx.by,
    question: snapshot(ctx.round),
    // Ce que les joueurs ont répondu (utile pour « réponse à accepter »)
    answers: ctx.answers ?? [],
  };
  if (type === 'accept' && !entry.accept && !entry.comment) throw new Error('Écris la réponse à accepter');
  return entry;
}

export const feedback = {
  file: FEEDBACK_FILE,
  add(entry) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    if (store.name === 'supabase') {
      const { id, at, ...data } = entry;
      store.insert('reports', { id, created_at: at, type: entry.type, status: 'pending', data }).catch((err) => console.error('[signalements]', err.message));
    }
    return entry;
  },
  list() {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    return text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  },
};
