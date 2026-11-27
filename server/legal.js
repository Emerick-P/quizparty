// Pages légales, ouvertes à tous : Google les lit avant d'autoriser
// la connexion « avec Google ». Adresse de contact : variable CONTACT_EMAIL (jamais écrite dans le code).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UPDATED = '27 novembre 2026';

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · QuizParty</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  :root { color-scheme: dark; --bg: #22262e; --card: #2a2f38; --line: #3a414c; --text: #f2f3f5; --muted: #a0a7b3; --accent: #5fd0e3; --bad: #ec7182; }
  @media (prefers-color-scheme: light) { :root { color-scheme: light; --bg: #eceef3; --card: #fff; --line: #d3d8e2; --text: #1a2040; --muted: #5b6386; --accent: #1f6fb2; --bad: #c62f45; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 28px 16px 60px; }
  .logo { font-weight: 800; font-size: 1.3rem; text-decoration: none; color: var(--text); }
  .logo b { color: var(--accent); }
  h1 { font-size: 1.8rem; line-height: 1.2; margin: 22px 0 4px; }
  h2 { font-size: 1.15rem; margin: 28px 0 6px; }
  .muted { color: var(--muted); font-size: .92rem; }
  a { color: var(--accent); }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  .box { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-top: 12px; }
  button { font: inherit; font-weight: 600; border-radius: 8px; padding: 10px 16px; border: 1px solid var(--bad); background: transparent; color: var(--bad); cursor: pointer; }
  button[disabled] { opacity: .5; cursor: default; }
</style></head>
<body><main>
<a class="logo" href="/">Quiz<b>Party</b></a>
<h1>${esc(title)}</h1>
<p class="muted">Dernière mise à jour : ${UPDATED}</p>
${body}
<p class="muted" style="margin-top:36px"><a href="/confidentialite">Confidentialité</a> · <a href="/conditions">Conditions d’utilisation</a> · <a href="/">Retour au jeu</a></p>
</main></body></html>`;
}

const contactLine = (email) => (email
  ? `Pour toute question ou demande sur tes données : <a href="mailto:${esc(email)}">${esc(email)}</a>.`
  : 'Pour toute question ou demande sur tes données, écris à la personne qui t’a invité sur QuizParty : c’est elle qui gère le site.');

export function privacyPage(email) {
  return page('Règles de confidentialité', `
<p>QuizParty est un petit jeu de quiz entre amis, gratuit, sans publicité et sans but commercial. On collecte le moins de données possible, uniquement pour faire marcher le jeu.</p>

<h2>Sans compte (invité)</h2>
<ul>
  <li>Ton pseudo est gardé sur ton appareil et, le temps d’une partie, dans la mémoire du serveur. Il disparaît quand le salon se ferme.</li>
  <li>Il n’y a aucun cookie publicitaire ni de mesure d’audience.</li>
</ul>

<h2>Avec un compte (Discord ou Google)</h2>
<p>Le compte est facultatif. Quand tu te connectes, on reçoit de Discord ou Google :</p>
<ul>
  <li>un identifiant technique, ton nom affiché et ta photo de profil ;</li>
  <li>ton adresse e-mail, conservée par notre service de connexion (Supabase) mais jamais affichée, ni utilisée pour t’écrire, ni partagée.</li>
</ul>
<p>Ces informations servent à te reconnaître d’une partie à l’autre et à réserver certaines actions d’administration. Plus tard, elles pourront servir à des fonctions du jeu (statistiques, défis entre amis). On ne demande aucun autre accès à ton compte Discord ou Google : ni tes messages, ni tes contacts, ni tes fichiers.</p>

<h2>Ce que tu envoies</h2>
<ul>
  <li>Les signalements (⚑) et les propositions de questions sont enregistrés avec ton pseudo et, si tu es connecté, ton identifiant de compte, pour pouvoir corriger le jeu.</li>
  <li>Si tu lies ton profil Steam, le jeu lit ses informations publiques (jeux, succès) pendant la partie. Elles ne sont pas conservées.</li>
</ul>

<h2>Où sont les données</h2>
<p>Le site est hébergé par Render et les données par Supabase, tous deux en Europe (Francfort). Elles ne sont ni vendues, ni louées, ni utilisées pour de la publicité.</p>

<h2>Durée et suppression</h2>
<p>Ton compte est conservé tant que tu ne le supprimes pas. Tu peux le supprimer toi-même ici, avec ton nom et ta photo :</p>
<div class="box" id="del">
  <p id="del-text" class="muted">Connecte-toi sur QuizParty depuis cet appareil pour pouvoir supprimer ton compte ici.</p>
  <button id="del-btn" type="button" hidden>Supprimer mon compte</button>
</div>
<p>${contactLine(email)} Tu peux aussi demander l’accès à tes données ou leur correction.</p>

<script>
(() => {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('quizparty:auth')); } catch (e) {}
  const btn = document.getElementById('del-btn'), text = document.getElementById('del-text');
  if (!s || !s.access_token) return;
  text.textContent = 'Connecté' + (s.user && s.user.name ? ' en tant que ' + s.user.name : '') + '. La suppression est définitive.';
  btn.hidden = false;
  btn.onclick = async () => {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Confirmer la suppression définitive'; return; }
    btn.disabled = true;
    let ok = false, msg = '';
    for (let i = 0; i < 2 && !ok; i++) {
      const r = await fetch('/api/auth/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: s.access_token }) }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      ok = !!(r && r.ok); msg = d.error || 'Pas de réponse du serveur';
      if (!ok && r && r.status === 401 && s.refresh_token && i === 0) {
        const rr = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) }).catch(() => null);
        if (rr && rr.ok) Object.assign(s, await rr.json()); else break;
      } else break;
    }
    if (ok) { try { localStorage.removeItem('quizparty:auth'); } catch (e) {} text.textContent = 'Ton compte a été supprimé. Tu peux toujours jouer en invité.'; btn.hidden = true; }
    else { text.textContent = msg; btn.disabled = false; }
  };
})();
</script>`);
}

export function termsPage(email) {
  return page('Conditions d’utilisation', `
<p>QuizParty est un jeu de quiz sur le jeu vidéo, à jouer entre amis dans le navigateur. En l’utilisant, tu acceptes ces quelques règles simples.</p>

<h2>Le service</h2>
<ul>
  <li>Le jeu est gratuit, proposé à titre personnel et sans garantie : il peut être indisponible, changer ou s’arrêter à tout moment.</li>
  <li>Le compte (Discord ou Google) est facultatif : on peut toujours jouer en invité.</li>
</ul>

<h2>Bonne conduite</h2>
<ul>
  <li>Choisis un pseudo correct et reste fair-play : pas de triche, d’insultes ni de contenu choquant.</li>
  <li>L’hôte d’un salon peut retirer un joueur. Un compte utilisé de façon abusive peut être supprimé.</li>
</ul>

<h2>Ce que tu proposes</h2>
<p>En proposant une question, une image ou un son, tu confirmes avoir le droit de le partager, et tu autorises son utilisation dans QuizParty. Une proposition peut être modifiée, refusée ou retirée.</p>

<h2>Contenus des jeux</h2>
<p>Les noms, jaquettes, images et sons des jeux appartiennent à leurs éditeurs respectifs. Les données et jaquettes de jeux viennent d’<a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB.com</a>. Un contenu peut être retiré sur simple demande.</p>

<h2>Contact</h2>
<p>${contactLine(email)}</p>
<p>Voir aussi les <a href="/confidentialite">règles de confidentialité</a>.</p>`);
}

export function installLegal(app, env = process.env) {
  const email = (env.CONTACT_EMAIL || '').trim();
  const send = (html) => (_req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(html); };
  app.get(['/confidentialite', '/confidentialite.html'], send(privacyPage(email)));
  app.get(['/conditions', '/conditions.html'], send(termsPage(email)));
}
