// Accès « entre amis » : si la variable d'environnement ACCESS_CODE est définie, le site
// demande ce code une fois (page /entree), puis retient l'appareil grâce à un cookie.
// Sans ACCESS_CODE (en local, ou le jour d'une ouverture publique), tout est ouvert.
//
// Le cookie ne contient pas le code lui-même mais une empreinte (HMAC). Changer ACCESS_CODE
// dans .env puis redémarrer déconnecte donc tous les appareils.
import crypto from 'node:crypto';
import express from 'express';

const COOKIE = 'qp_access';
const MAX_AGE_S = 180 * 24 * 3600; // 6 mois
const OPEN_PATHS = new Set(['/entree', '/health', '/tv', '/tv.html', '/tv.js', '/tv.css', '/plateau.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/sw.js']);
const GRANT_TTL_MS = 3 * 60 * 1000; // laissez-passer d'un écran télé appairé par l'hôte
const MAX_TRIES = 10; // essais ratés par adresse IP…
const TRIES_WINDOW_MS = 10 * 60 * 1000; // …par tranche de 10 minutes

export function createAccess(code = process.env.ACCESS_CODE) {
  code = (code || '').trim();
  // Écran télé : la page /tv est ouverte, et sa connexion temps réel « limitée » ne sert qu'à
  // s'appairer. Quand l'hôte (lui, entré avec le code) l'appaire, l'écran reçoit un laissez-passer
  // à usage unique qui lui pose le cookie d'accès : personne n'a à taper le code avec la télécommande.
  const limited = (socket) => socket.handshake.auth?.screen === true;
  if (!code) return { enabled: false, install() {}, grant: () => null, socketGuard: (_s, next) => next() };
  const grants = new Map(); // laissez-passer → expiration

  const token = crypto.createHmac('sha256', code).update('quizparty-access-v1').digest('hex');
  const tries = new Map(); // ip -> { n, since }

  const same = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const cookieOf = (header = '') => {
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return '';
  };
  const allowed = (cookieHeader) => same(cookieOf(cookieHeader), token);
  // Redirection uniquement vers une page de ce site (pas « //autre-site.com »)
  const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/');

  function tooMany(ip) {
    const t = tries.get(ip);
    if (!t || Date.now() - t.since > TRIES_WINDOW_MS) return false;
    return t.n >= MAX_TRIES;
  }
  function fail(ip) {
    const t = tries.get(ip);
    if (!t || Date.now() - t.since > TRIES_WINDOW_MS) tries.set(ip, { n: 1, since: Date.now() });
    else t.n++;
    if (tries.size > 5000) tries.clear(); // garde-fou mémoire
  }

  /** Laissez-passer à usage unique pour un écran télé appairé par l'hôte. */
  function grant() {
    const now = Date.now();
    for (const [g, exp] of grants) if (exp < now) grants.delete(g);
    const g = crypto.randomBytes(18).toString('hex');
    grants.set(g, now + GRANT_TTL_MS);
    return g;
  }

  function install(app) {
    app.get('/tv/entree', (req, res) => {
      const g = String(req.query.g || '');
      const exp = grants.get(g);
      res.set('Cache-Control', 'no-store');
      if (!exp || exp < Date.now()) return res.redirect(302, '/tv');
      grants.delete(g);
      res.cookie(COOKIE, token, { maxAge: MAX_AGE_S * 1000, httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
      res.redirect(303, safeNext(req.query.next || '/tv'));
    });
    app.get('/entree', (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.type('html').send(page({ next: safeNext(req.query.next) }));
    });
    app.post('/entree', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
      const ip = req.ip;
      const next = safeNext(req.body?.next);
      res.set('Cache-Control', 'no-store');
      if (tooMany(ip)) return res.status(429).type('html').send(page({ next, error: 'Trop d’essais. Réessaie dans quelques minutes.' }));
      if (!same((req.body?.code || '').trim().toLowerCase(), code.toLowerCase())) {
        fail(ip);
        return res.status(401).type('html').send(page({ next, error: 'Ce n’est pas le bon code.' }));
      }
      tries.delete(ip);
      res.cookie(COOKIE, token, { maxAge: MAX_AGE_S * 1000, httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
      res.redirect(303, next);
    });
    // Tout le reste passe par la vérification du cookie
    app.use((req, res, next) => {
      if (OPEN_PATHS.has(req.path) || allowed(req.headers.cookie)) return next();
      // Une page (« / », « /index.html »…) renvoie vers l'entrée ; un fichier (script, image, son) est refusé
      if (req.method === 'GET' && (!/\.[a-z0-9]+$/i.test(req.path) || req.path.endsWith('.html'))) {
        return res.redirect(302, `/entree?next=${encodeURIComponent(req.originalUrl)}`);
      }
      res.sendStatus(401);
    });
  }

  // Connexions temps réel : même cookie, envoyé par le navigateur avec la poignée de main
  function socketGuard(socket, next) {
    if (allowed(socket.request.headers.cookie)) return next();
    if (limited(socket)) {
      socket.data.limited = true; // écran télé pas encore entré : appairage seulement
      return next();
    }
    const err = new Error('access');
    err.data = { access: true };
    next(err);
  }

  return { enabled: true, install, grant, socketGuard };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page({ next, error = '' }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#14102a">
<meta name="robots" content="noindex">
<title>QuizParty</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    background: #14102a; color: #f4f1ff; font: 16px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { width: 100%; max-width: 360px; text-align: center; }
  h1 { font-size: 2.2rem; margin: 0 0 4px; color: #ffcf3f; letter-spacing: .5px; }
  p { margin: 0 0 20px; color: #b9b2d9; }
  input, button { width: 100%; font: inherit; border-radius: 12px; padding: 14px 16px; border: 0; }
  input { background: #241d47; color: #fff; text-align: center; font-size: 1.2rem; outline: 2px solid transparent; }
  input:focus { outline-color: #ffcf3f; }
  button { margin-top: 12px; background: #ffcf3f; color: #14102a; font-weight: 700; cursor: pointer; }
  .why { font-size: .85rem; color: #8d86ad; margin: -8px 0 20px; }
  .err { color: #ff7a8a; margin: 12px 0 0; }
</style>
</head>
<body>
<main>
  <h1>QuizParty</h1>
  <p>Entre le code d’accès que t’a donné l’organisateur.</p>
  <p class="why">C’est un petit site perso entre amis, hébergé gratuitement, avec du contenu qu’on ne peut pas diffuser publiquement : le code se passe de pote à pote, pas sur un forum ni sur les réseaux 🙂</p>
  <form method="post" action="/entree">
    <input type="hidden" name="next" value="${esc(next)}">
    <input name="code" type="password" autocomplete="current-password" placeholder="Code d’accès" aria-label="Code d’accès" required autofocus>
    <button type="submit">Entrer</button>
    ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  </form>
</main>
</body>
</html>`;
}
