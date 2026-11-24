// npm run share : lance le serveur (s'il ne tourne pas déjà) + un tunnel Cloudflare gratuit,
// puis affiche le lien public à envoyer aux amis. Ctrl+C arrête tout.
//
// Le tunnel « rapide » de Cloudflare (trycloudflare.com) ne demande ni compte ni carte bancaire.
// Le lien change à chaque lancement et ne marche que tant que cette fenêtre reste ouverte.
import '../server/env.js';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const LOCAL = `http://localhost:${PORT}`;
const children = [];

function findCloudflared() {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  // 1) dans le PATH
  const probe = spawnSync(exe, ['--version'], { stdio: 'ignore', shell: false });
  if (!probe.error) return exe;
  // 2) emplacements d'installation courants sous Windows (winget / msi), même si le PATH
  //    n'a pas encore été rechargé dans ce terminal
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', exe),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    path.join(ROOT, exe),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

async function serverIsUp() {
  try {
    const res = await fetch(`${LOCAL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

async function waitForServer(ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await serverIsUp()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function stopAll(code = 0) {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

function banner(url) {
  const line = '='.repeat(Math.max(url.length + 8, 50));
  console.log(`\n${line}\n  Lien à envoyer à tes amis :\n\n    ${url}\n\n  (laisse cette fenêtre ouverte pendant la partie, Ctrl+C pour arrêter)\n${line}\n`);
}

async function main() {
  const cloudflared = findCloudflared();
  if (!cloudflared) {
    console.error(
      '\ncloudflared est introuvable. Installe-le une fois (gratuit) dans PowerShell :\n\n' +
        '    winget install --id Cloudflare.cloudflared\n\n' +
        'puis ferme et rouvre le terminal, et relance : npm run share\n',
    );
    process.exit(1);
  }

  // Serveur : on réutilise celui qui tourne déjà (npm start / npm run dev), sinon on le lance.
  if (await serverIsUp()) {
    console.log(`Serveur QuizParty déjà lancé sur ${LOCAL}, je le réutilise.`);
  } else {
    console.log('Démarrage du serveur QuizParty…');
    const srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, stdio: 'inherit', env: process.env });
    children.push(srv);
    srv.on('exit', (code) => {
      console.error(`\nLe serveur s'est arrêté (code ${code}).`);
      stopAll(code || 1);
    });
    if (!(await waitForServer())) {
      console.error(`Le serveur ne répond pas sur ${LOCAL}. Le port ${PORT} est peut-être pris par une autre application.`);
      stopAll(1);
    }
  }

  console.log('Ouverture du tunnel Cloudflare (quelques secondes)…');
  const tun = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', LOCAL], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(tun);

  let found = false;
  const onData = (buf) => {
    const text = buf.toString();
    if (process.env.SHARE_DEBUG) process.stderr.write(text);
    if (found) {
      // Après l'ouverture, on ne montre que les vraies erreurs du tunnel
      for (const l of text.split('\n')) if (/\bERR\b/.test(l)) console.error('[tunnel]', l.trim());
      return;
    }
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m) {
      found = true;
      banner(m[0]);
    }
  };
  tun.stdout.on('data', onData);
  tun.stderr.on('data', onData);
  tun.on('exit', (code) => {
    console.error(`\nLe tunnel s'est fermé (code ${code}).${found ? '' : ' Vérifie ta connexion internet, ou relance avec SHARE_DEBUG=1 pour voir le détail.'}`);
    stopAll(code || 1);
  });
  setTimeout(() => {
    if (!found) console.error('Le tunnel met du temps à répondre… (Cloudflare est parfois lent, patiente encore un peu)');
  }, 30000);
}

main();
