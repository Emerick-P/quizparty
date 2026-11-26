// Page « Proposer » : formulaire de soumission des amis (aucune dépendance).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAME_KEY = 'quizparty:name';
  const AUTH_KEY = 'quizparty:auth'; // compte connecté dans le jeu (jetons Supabase, en JSON)
  // Mêmes clés que le jeu, valeurs en JSON (voir store dans public/js/core.js)
  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage bloqué */ } },
  };

  /**
   * Jeton du compte connecté (renouvelé s'il expire bientôt), envoyé au serveur : les modes réservés
   * (sons, HUD, écrans de chargement) ne sont proposés qu'aux comptes au rôle friend/admin.
   */
  async function authHeader() {
    let s = store.get(AUTH_KEY);
    if (!s?.access_token) return {};
    if (s.expires_at * 1000 - Date.now() < 5 * 60_000 && s.refresh_token) {
      const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) }).catch(() => null);
      if (r?.ok) {
        s = { ...s, ...(await r.json()) };
        store.set(AUTH_KEY, s);
      }
    }
    return { Authorization: `Bearer ${s.access_token}` };
  }

  // Ouvert depuis le jeu (panneau du salon) : pas de lien « Retour », on ferme le panneau à la place
  const embed = new URLSearchParams(location.search).has('embed') && window.parent !== window;
  if (embed) {
    document.body.classList.add('embed');
    $('back').hidden = false;
    $('back').addEventListener('click', () => window.parent.postMessage({ type: 'quizparty:propose-close' }, location.origin));
  }

  let opts = null;
  let mode = null;
  let file = null; // { dataUrl, name, type, size }
  let truth = null;

  const field = (label, html, hint = '') => `<label class="field"><span>${label}${hint ? ` <small class="opt">${hint}</small>` : ''}</span>${html}</label>`;
  const gameField = (label = 'Le jeu') => field(label, `<input id="f-game" list="games" maxlength="120" autocomplete="off" placeholder="Commence à taper…">`);
  const infoField = (label = 'Explication', hint = '(facultatif, affichée à la correction)') => field(label, `<textarea id="f-info" maxlength="400" placeholder=""></textarea>`, hint);

  const forms = {
    quiz: () => `
      ${field('2. La question', `<textarea id="f-prompt" maxlength="600" placeholder="Ex : Dans Hollow Knight, comment s’appelle la ville sous la pluie ?"></textarea>`)}
      ${field('3. La bonne réponse', `<input id="f-answer" maxlength="200">`)}
      ${field('Mauvaises réponses', `<div class="wrong"><input class="f-wrong" maxlength="120"><input class="f-wrong" maxlength="120"><input class="f-wrong" maxlength="120"></div>`, '(facultatif, sinon on les invente)')}
      ${gameField('Le jeu concerné <small class="opt">(facultatif)</small>')}
      ${infoField()}`,
    vraifaux: () => `
      ${field('2. L’affirmation', `<textarea id="f-prompt" maxlength="600" placeholder="Ex : Dans Portal, le gâteau existe vraiment."></textarea>`)}
      <div class="field"><span>3. C’est…</span><div class="tf"><button type="button" class="btn" data-truth="1">Vrai</button><button type="button" class="btn" data-truth="0">Faux</button></div></div>
      ${infoField('Le vrai fait', '(facultatif, affiché à la correction)')}`,
    estimation: () => `
      ${field('2. La question', `<textarea id="f-prompt" maxlength="600" placeholder="Ex : Combien de Korogus faut-il trouver dans Breath of the Wild ?"></textarea>`)}
      <div class="two">
        ${field('3. La réponse exacte', `<input id="f-number" inputmode="decimal" maxlength="20" placeholder="900">`)}
        ${field('Unité', `<input id="f-unit" maxlength="40" placeholder="Korogus">`, '(facult.)')}
      </div>
      ${infoField()}`,
    covers: () => `${gameField('2. Le jeu')}`,
    pitch: () => `
      ${field('2. Le pitch', `<textarea id="f-prompt" maxlength="600" placeholder="Ex : Un plombier visite huit châteaux d’affilée, et à chaque fois on lui dit que ce n’est pas le bon."></textarea>`, '(sans nommer le jeu ni ses personnages)')}
      ${gameField('3. Le jeu')}`,
    emoji: () => `
      ${field('2. Les emojis', `<textarea id="f-prompt" class="emojis" maxlength="120" placeholder="🍰 🤥 🔵 🟠"></textarea>`)}
      ${gameField('3. Le jeu')}
      ${infoField('Explication', '(facultatif, pour que les autres comprennent à la correction)')}`,
    hud: () => `${fileField('image', '2. La capture', 'Une capture en pleine partie, avec l’interface bien visible. On masquera le décor nous-mêmes.')}${gameField('3. Le jeu')}`,
    loading: () => `${fileField('image', '2. La capture', 'Une capture de l’écran de chargement. On masquera le titre et le logo nous-mêmes.')}${gameField('3. Le jeu')}`,
    sounds: () => `${fileField('audio', '2. Le son', 'Quelques secondes, sans que le nom du jeu soit prononcé.')}${gameField('3. Le jeu')}
      ${field('Ce qu’on entend', `<input id="f-info" maxlength="400" placeholder="Ex : la pièce, le cri du Pokémon, le menu…">`, '(facultatif)')}`,
  };

  function fileField(kind, label, hint) {
    const accept = kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'audio/*';
    return `<div class="field"><span>${label}</span>
      <label class="drop" id="drop"><input type="file" id="f-file" accept="${accept}">
        <span id="drop-txt">${kind === 'image' ? '📷 Choisir une image' : '🔊 Choisir un son'}</span></label>
      <small class="muted">${hint}</small>
      <div class="preview" id="preview"></div></div>`;
  }

  function common() {
    return `
      ${field('Source', `<input id="f-source" maxlength="500" placeholder="Lien, wiki, « je l’ai vu en jouant »…">`, '(facultatif, ça aide à vérifier)')}
      ${field('Ton pseudo', `<input id="f-author" maxlength="24" value="${esc(store.get(NAME_KEY) || '')}">`, '(facultatif)')}`;
  }

  function renderModes() {
    $('modes').innerHTML = Object.entries(opts.modes)
      .map(([id, m]) => `<button type="button" class="mode ${id === mode ? 'sel' : ''}" data-mode="${id}"><b>${esc(m.name)}</b></button>`)
      .join('');
  }

  function selectMode(id) {
    mode = id;
    file = null;
    truth = null;
    renderModes();
    $('fields').innerHTML = `<p class="muted hint">${esc(opts.modes[id].hint)}</p>${forms[id]()}${common()}`;
    $('fields').hidden = false;
    $('send').hidden = false;
    showError('');
    const f = $('f-file');
    if (f) f.addEventListener('change', () => pickFile(f.files[0], opts.modes[id].file));
  }

  function showError(msg) {
    $('error').textContent = msg;
    $('error').hidden = !msg;
  }

  const readAsDataUrl = (blob) => new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });

  /** Image trop lourde : réduite à 2560 px de large au plus, en WebP (qualité 0,92). */
  async function shrink(f) {
    const img = await createImageBitmap(f);
    const scale = Math.min(1, 2560 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob(ok, 'image/webp', 0.92));
  }

  async function pickFile(f, kind) {
    showError('');
    if (!f) return;
    let blob = f;
    if (kind === 'image' && f.size > opts.maxImage * 0.9) {
      try { blob = await shrink(f); } catch { /* on tente l'envoi tel quel */ }
    }
    const max = kind === 'image' ? opts.maxImage : opts.maxAudio;
    if (blob.size > max) {
      file = null;
      return showError(`Fichier trop lourd (${Math.ceil(max / 1048576)} Mo maximum).`);
    }
    file = { dataUrl: await readAsDataUrl(blob), name: f.name };
    $('drop').classList.add('has');
    $('drop-txt').textContent = `✓ ${f.name} (${(blob.size / 1048576).toFixed(1)} Mo) · changer`;
    $('preview').innerHTML = kind === 'image' ? `<img alt="" src="${file.dataUrl}">` : `<audio controls src="${file.dataUrl}"></audio>`;
  }

  const val = (id) => $(id)?.value.trim() ?? '';

  async function send(e) {
    e.preventDefault();
    if (!mode) return showError('Choisis un mode.');
    const body = {
      mode,
      prompt: val('f-prompt'),
      answer: val('f-answer'),
      game: val('f-game'),
      info: val('f-info'),
      unit: val('f-unit'),
      number: val('f-number'),
      source: val('f-source'),
      author: val('f-author'),
      wrong: [...document.querySelectorAll('.f-wrong')].map((i) => i.value.trim()).filter(Boolean),
      truth,
      file: file?.dataUrl,
    };
    $('send').disabled = true;
    $('send').textContent = 'Envoi…';
    try {
      const res = await fetch('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Envoi impossible, réessaie.');
      $('form').hidden = true;
      $('done').hidden = false;
      window.scrollTo(0, 0);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Pas de connexion, réessaie.' : err.message);
    } finally {
      $('send').disabled = false;
      $('send').textContent = 'Envoyer';
    }
  }

  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) return selectMode(m.dataset.mode);
    const t = e.target.closest('[data-truth]');
    if (t) {
      truth = t.dataset.truth === '1';
      document.querySelectorAll('[data-truth]').forEach((b) => b.classList.toggle('sel', b === t));
    }
  });
  $('form').addEventListener('submit', send);
  $('again').addEventListener('click', () => {
    $('done').hidden = true;
    $('form').hidden = false;
    selectMode(mode);
  });

  authHeader()
    .then((headers) => fetch('/api/submit/options', { headers }))
    .then((r) => r.json())
    .then((o) => {
      opts = o;
      $('games').innerHTML = o.games.map((g) => `<option value="${esc(g)}">`).join('');
      renderModes();
      const want = new URLSearchParams(location.search).get('mode');
      if (want && o.modes[want]) selectMode(want);
    })
    .catch(() => showError('Impossible de charger le formulaire. Recharge la page.'));
})();
