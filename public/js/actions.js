// QuizParty — Actions des boutons (data-action) : créer/rejoindre, répondre, réglages de l’hôte…
// Script classique (pas un module) : les fichiers de public/js partagent leurs déclarations, voir CLAUDE.md.
'use strict';

// =====================================================================  actions
function getName() {
  const field = $('#name');
  const name = (field ? field.value : store.get(NAME_KEY) || '').trim();
  if (!name) { toast('Choisis un pseudo'); field ? field.focus() : openSheet('create'); return null; }
  store.set(NAME_KEY, name);
  return name;
}

async function answer(value) {
  const r = state?.round;
  if (!r || pending || r.yourAnswer !== null || displayPhase() !== 'question') return;
  pending = { roundId: r.id, answer: value };
  if (navigator.vibrate) navigator.vibrate(15);
  render();
  const res = await send('game:answer', { roundId: r.id, answer: value });
  if (res.wrong) {
    // Mauvais titre mais il reste des essais
    if (pending && pending.roundId === r.id) pending = null;
    if (state?.round?.id === r.id) state.round.yourMisses = r.tries - res.triesLeft;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    render();
    const input = $('#guess-input');
    if (input) { input.value = ''; input.focus(); } // garde le clavier ouvert pour retenter
    toast(`Non ! Encore ${res.triesLeft} essai${res.triesLeft > 1 ? 's' : ''}`);
    $('.guess')?.classList.add('shake');
    return;
  }
  if (res.correct !== undefined && state?.round?.id === r.id) state.round.yourCorrect = res.correct;
  if (res.error) {
    toast(res.error);
    if (pending && pending.roundId === r.id) pending = null;
    render();
  }
}

/**
 * Un clic copie le lien du salon ; le bouton affiche « Lien copié ! » un instant.
 * navigator.clipboard n'existe qu'en https ou sur localhost : en http sur le réseau local (192.168…),
 * on passe par l'ancienne méthode (champ caché + copier).
 */
let copiedUntil = 0;
const COPIED_MS = 1200;
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* refusé */ }
  ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error('copie refusée'));
}
/** Téléphone : on se passe le code (4 lettres), pas le lien. */
async function copyCode() {
  try { await copyText(state.code); } catch { return toast(`Code du salon : ${state.code}`); }
  copiedUntil = Date.now() + COPIED_MS;
  render();
  setTimeout(render, COPIED_MS + 20);
}
async function share() {
  const url = `${location.origin}/?code=${state.code}`;
  try { await copyText(url); } catch { return toast(url); } // à défaut, on affiche le lien pour le copier à la main
  copiedUntil = Date.now() + COPIED_MS;
  render();
  setTimeout(render, COPIED_MS + 20);
}

const actions = {
  rvpage(btn) {
    const el = document.querySelector('.rv-swipe.on');
    if (el) el.scrollTo({ left: btn.dataset.value === '1' ? el.scrollWidth : 0, behavior: 'smooth' });
  },
  theme(btn) { setTheme(btn.dataset.value === 'light' ? 'light' : 'dark'); render(); },
  async create() {
    const name = getName(); if (!name) return;
    const res = await send('room:create', { name, look: store.get(LOOK_KEY) ?? undefined });
    if (res.error) return toast(res.error);
    enterRoom(res);
  },
  async join() {
    const name = getName(); if (!name) return;
    const code = ($('#code')?.value || '').trim().toUpperCase();
    if (code.length !== 4) return toast('Le code fait 4 lettres');
    const res = await send('room:join', { code, name, look: store.get(LOOK_KEY) ?? undefined });
    if (res.error) return toast(res.error);
    enterRoom(res);
  },
  async leave() { await send('room:leave'); leaveLocal(); },
  async install() {
    if (!pwa.prompt) return;
    pwa.prompt.prompt();
    const choice = await pwa.prompt.userChoice.catch(() => null);
    pwa.prompt = null;
    if (choice?.outcome === 'accepted') {
      if (ui.sheet === 'getapp') ui.sheet = null;
      try { localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
      toast(INSTALLED_MSG);
    }
    render();
  },
  tvsheet() { tv.sheet = true; render(); setTimeout(() => $('#tv-pin')?.focus(), 50); },
  tvclose() { tv.sheet = false; render(); },
  async tvoff() { const r = await send('room:screen-off'); if (r.error) toast(r.error); },
  share,
  copycode: copyCode,
  async start() { const r = await send('game:start'); if (r.error) toast(r.error); },
  async skip() { const r = await send('game:skip'); if (r.error) toast(r.error); },
  async stop(btn) {
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Confirmer ?';
      setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = 'Arrêter'; } }, 3000);
      return;
    }
    const r = await send('game:stop'); if (r.error) toast(r.error);
  },
  async lobby() { const r = await send('game:stop'); if (r.error) toast(r.error); },
  async resetTotals(btn) {
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Confirmer la remise à zéro ?';
      setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = 'Remettre à zéro'; } }, 3000);
      return;
    }
    const r = await send('room:reset-totals');
    if (r.error) return toast(r.error);
    toast('Score global remis à zéro');
  },
  async steamLink() {
    const profile = ($('#steam-input')?.value || '').trim();
    if (!profile) return toast('Colle l\'adresse de ton profil Steam');
    store.set(STEAM_KEY, profile);
    const r = await send('steam:link', { profile });
    if (r.error) toast(r.error);
  },
  steamHelp() { steamHelpOpen = true; render(); },
  steamHelpClose() { steamHelpOpen = false; render(); },
  noop() {},
  async steamUnlink() {
    store.del(STEAM_KEY);
    const r = await send('steam:unlink');
    if (r.error) toast(r.error);
  },
  async kick(btn) { const r = await send('room:kick', { playerId: btn.dataset.id }); if (r.error) toast(r.error); },
  async set(btn) {
    const r = await send('room:settings', { [btn.dataset.key]: btn.dataset.value });
    if (r.error) toast(r.error);
  },
  async mixpart(btn) {
    const r = await send('room:settings', { mixPart: btn.dataset.value });
    if (r.error) toast(r.error);
  },
  answer(btn) { answer(Number(btn.dataset.index)); },
  zoom(el) { zoomShot(el.getAttribute('src')); },
  async ban(btn) {
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Confirmer le retrait ?';
      return;
    }
    const kind = state.round?.kind;
    const r = await send('game:ban-cover');
    if (r.error) return toast(r.error);
    toast(kind === 'screen' ? 'Image retirée des prochaines parties' : kind === 'sound' ? 'Son retiré des prochaines parties' : 'Jeu retiré des prochaines parties');
  },
  replay() { replaySound(); },
  async pause() { const r = await send('game:pause'); if (r.error) toast(r.error); },
  async login(btn) {
    const cfg = await accountConfig();
    if (!cfg?.enabled || !cfg.providers.includes(btn.dataset.value)) return toast('Connexion indisponible pour le moment');
    // Retour sur la même page (garde ?code=… d'une invitation)
    const back = location.origin + location.pathname + location.search;
    location.href = `${cfg.url}/auth/v1/authorize?provider=${encodeURIComponent(btn.dataset.value)}&redirect_to=${encodeURIComponent(back)}`;
  },
  async logout() {
    clearTimeout(account.timer);
    store.del(AUTH_KEY);
    account.user = null;
    await send('auth:clear');
    ui.sheet = null;
    toast('Déconnecté : tu joues en invité');
    render();
  },
  async saveName() {
    const name = getName(); if (!name) return;
    if (account.user || state) {
      const r = await send('profile:name', { name });
      if (r.error) return toast(r.error);
      if (r.renamed && r.renamed !== name) toast(`Pseudo déjà pris dans le salon : tu es « ${r.renamed} »`);
      else toast('Pseudo enregistré');
    }
    closeSheet();
  },
  async deleteAccount(btn) {
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Confirmer la suppression définitive';
      return;
    }
    btn.disabled = true;
    const del = (s) => fetch('/api/auth/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: s.access_token }) }).catch(() => null);
    let s = store.get(AUTH_KEY);
    let r = s ? await del(s) : null;
    if (r?.status === 401 && s?.refresh_token) {
      const again = await accountRefresh({ ...s, expires_at: 0 });
      if (again && again.access_token !== s.access_token) { store.set(AUTH_KEY, again); s = again; r = await del(s); }
    }
    btn.disabled = false;
    if (!r?.ok) return toast((await r?.json().catch(() => null))?.error || 'Suppression impossible pour le moment, réessaie plus tard');
    clearTimeout(account.timer);
    store.del(AUTH_KEY);
    account.user = null;
    await send('auth:clear');
    ui.sheet = null;
    toast('Ton compte a été supprimé. Tu joues en invité.');
    render();
  },
  flag() { report.open = true; report.type = null; report.roundId = state.round?.id ?? null; render(); },
  flagclose() { report.open = false; render(); },
  async resume() { const r = await send('game:resume'); if (r.error) toast(r.error); },
  reportType(btn) { report.type = btn.dataset.value; render(); },
  reportPick(btn) {
    const input = $('#report-accept');
    if (input) input.value = btn.dataset.value;
  },
  async reportSend(btn) {
    if (!report.type) return toast('Choisis le type de retour');
    const accept = $('#report-accept')?.value.trim() || '';
    const comment = $('#report-comment')?.value.trim() || '';
    if (report.type === 'accept' && !accept) return toast('Écris la réponse à accepter');
    if (report.type === 'other' && !comment) return toast('Décris le souci en quelques mots');
    btn.disabled = true;
    const r = await send('game:report', { type: report.type, accept, comment, roundId: state.round?.id, resume: btn.dataset.resume === 'yes' });
    btn.disabled = false;
    if (r.error) return toast(r.error);
    report.type = null;
    report.open = false;
    for (const el of ['#report-accept', '#report-comment']) if ($(el)) $(el).value = '';
    toast('Retour enregistré, merci !');
    render();
  },
};
