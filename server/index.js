import './env.js'; // en premier : charge .env avant que les autres modules lisent process.env
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { covers } from './images/index.js';
import { screens } from './images/screens.js';
import { sounds } from './images/sounds.js';
import { createAccess } from './access.js';
import { installSubmissions } from './submissions.js';
import { store } from './store.js';
import { syncContent } from './content-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Détection rapide des déconnexions (le joueur apparaît "hors ligne" en quelques secondes)
  pingInterval: 8000,
  pingTimeout: 12000,
});

const PUBLIC = path.join(__dirname, '..', 'public');

// En ligne, le serveur est derrière Caddy (HTTPS) : on lui fait confiance pour l'IP du joueur
// et le protocole (cookie « secure »). TRUST_PROXY=1 dans le .env du serveur.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

// Code d'accès « entre amis » (ACCESS_CODE dans .env) ; sans lui, le site est ouvert
const access = createAccess();
access.install(app);
io.use(access.socketGuard);

// Formulaire « Proposer » (/proposer) : soumissions des amis, derrière le même code d'accès
installSubmissions(app);

// Page d'accueil : les liens vers app.js / style.css portent une version tirée des fichiers
// (?v=…). Dès qu'un fichier change, son URL change : ni le navigateur ni le tunnel Cloudflare
// ne peuvent resservir l'ancienne version, même sans vider le cache.
const version = (file) => {
  try {
    const st = fs.statSync(path.join(PUBLIC, file));
    return `${st.mtimeMs.toString(36)}-${st.size.toString(36)}`.replace('.', '');
  } catch {
    return '0';
  }
};
function sendIndex(_req, res) {
  const html = fs
    .readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replace('"/app.js"', `"/app.js?v=${version('app.js')}"`)
    .replace('"/style.css"', `"/style.css?v=${version('style.css')}"`);
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
}
app.get(['/', '/index.html'], sendIndex);
// Écran télé (mode télé) : même principe de version que l'accueil
app.get(['/tv', '/tv.html'], (_req, res) => {
  const html = fs
    .readFileSync(path.join(PUBLIC, 'tv.html'), 'utf8')
    .replace('"/tv.js"', `"/tv.js?v=${version('tv.js')}"`)
    .replace('"/tv.css"', `"/tv.css?v=${version('tv.css')}"`);
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});
// Les autres fichiers : toujours revérifiés auprès du serveur (pas de copie périmée)
app.use(express.static(PUBLIC, { extensions: ['html'], setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size, covers: covers.status() }));

// Jaquettes en cache, sous un identifiant opaque (l'URL ne trahit pas le jeu)
app.get('/img/:id', (req, res) => {
  const f = covers.file(req.params.id);
  if (!f) return res.sendStatus(404);
  res.type(f.type);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(f.path);
});

// Captures des modes HUD / Écran de chargement (data/screens/), sous un nom de fichier aléatoire
app.get('/shot/:file', (req, res) => {
  const f = screens.file(req.params.file);
  if (!f) return res.sendStatus(404);
  res.type('image/webp');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(f);
});

// Sons du mode « Quel jeu fait ce bruit ? » (data/sounds/), sous un nom de fichier aléatoire
app.get('/sfx/:file', (req, res) => {
  const f = sounds.file(req.params.file);
  if (!f) return res.sendStatus(404);
  res.type('audio/mpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(f);
});

const rooms = new RoomManager(io, { access });
io.on('connection', (socket) => rooms.handleConnection(socket));

const PORT = Number(process.env.PORT) || 3000;
// HOST=127.0.0.1 en ligne : seul Caddy peut joindre Node, tout passe par HTTPS
const HOST = process.env.HOST || undefined;
// Les jaquettes se chargent en arrière-plan : les autres modes sont jouables tout de suite
covers
  .init()
  .catch((err) => console.error('[jaquettes]', err))
  .finally(() => { for (const room of rooms.rooms.values()) room.broadcast(); }); // dégrise les modes dans les salons ouverts

// Supabase gratuit se met en pause après 7 jours sans activité : une petite requête au démarrage
// (chaque réveil de Render) et une par jour tant que le serveur tourne.
if (store.name === 'supabase') {
  const ping = () => store.ping().catch((err) => console.error('[supabase]', err.message));
  ping();
  setInterval(ping, 24 * 3600_000).unref();
  // Copie en lecture du contenu (questions, pitchs…) pour l'explorer dans Supabase, si elle a changé
  syncContent(store)
    .then((r) => r.updated && console.log(`[supabase] contenu copié : ${r.count} lignes`))
    .catch((err) => console.error('[supabase] copie du contenu :', err.message));
}

server.listen(PORT, HOST, () => {
  console.log(`QuizParty prêt sur http://${HOST || 'localhost'}:${PORT}${access.enabled ? ' (code d’accès activé)' : ''}, soumissions : ${store.name}`);
});
