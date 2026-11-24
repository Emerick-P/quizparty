import crypto from 'node:crypto';
import { gameImage } from '../steam.js';
import { normalize, baseTitles } from './fuzzy.js';

/**
 * « Ta bande » : questions tirées des profils Steam liés par les joueurs du salon.
 *
 * La plupart des questions portent sur un joueur (`about`) : il peut répondre, mais ne marque pas dessus
 * (voir Room.endQuestion). Les questions de groupe (qui a le plus d'heures sur tel jeu…) n'ont pas de
 * joueur concerné : tout le monde marque. Les questions tournent entre les joueurs liés et le groupe pour
 * que chacun soit concerné autant de fois que les autres. Les manches réutilisent les types existants : `qcm` (choix) et `estimation`.
 *
 * ctx.players : joueurs du salon dont le profil Steam est public, [{ id, name, steam: { id, games } }].
 */
export const MIN_LINKED = 2;
const ONCE = new Set(['age', 'level', 'recent', 'library', 'rarest']); // une seule question de ce type par partie
const GROUP = '_group'; // questions sur toute la bande (personne n'est « concerné »)

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const nf = new Intl.NumberFormat('fr-FR');
export const hoursText = (min) => (min <= 0 ? 'jamais lancé' : min < 60 ? `${min} min` : `${nf.format(Math.round(min / 60))} h`);
const picture = (g) => ({ url: gameImage(g.appid), alt: g.name });

export const linkedPlayers = (ctx) => (ctx?.players ?? []).filter((p) => p.steam?.status === 'ok' && p.steam.games?.length);

export function bandeUnavailable(ctx) {
  const n = linkedPlayers(ctx).length;
  if (n >= MIN_LINKED) return null;
  return `Il faut ${MIN_LINKED} joueurs avec un profil Steam public lié (${n}/${MIN_LINKED}). Lie le tien dans le salon.`;
}

/** Manche à choix : la bonne réponse est en premier dans `choices`, mélangée ici. */
function choiceRound({ prompt, choices, about, info, image, revealImage, key, type }) {
  const order = shuffle(choices.map((_, i) => i));
  return {
    kind: 'qcm', bande: type, key, prompt, about, info,
    choices: order.map((i) => choices[i]),
    correctIndex: order.indexOf(0),
    picture: image ?? null,
    revealPicture: revealImage ?? image ?? null,
  };
}

/** Joueurs à proposer : le bon + jusqu'à 3 autres (d'abord ceux qui possèdent le jeu, plus crédibles). */
function playerChoices(winner, others) {
  return [winner.name, ...others.slice(0, 3).map((p) => p.name)];
}

// ---- Les cinq types de questions. Chacun renvoie la liste des questions possibles pour un joueur.

/** Quel est le jeu le plus joué de X ? (3 autres jeux de X en fausses propositions) */
function topGame(p) {
  const played = p.steam.games.filter((g) => g.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  if (played.length < 4 || played[0].minutes === played[1].minutes) return [];
  const top = played[0];
  const rivals = shuffle(played.slice(1, 12)).slice(0, 3);
  return [{
    type: 'top', key: `top:${p.steam.id}:${top.appid}`,
    make: () => choiceRound({
      type: 'top', key: `top:${p.steam.id}:${top.appid}`, about: p.id,
      prompt: `Quel est le jeu le plus joué de ${p.name} sur Steam ?`,
      choices: [top.name, ...rivals.map((g) => g.name)],
      info: [top, ...rivals].map((g) => `${g.name} : ${hoursText(g.minutes)}`).join(' · '),
      revealImage: picture(top),
    }),
  }];
}

// ---- Pile de la honte : on écarte les « jeux » qu'on n'est pas censé lancer

/** Bêtas, démos, serveurs, outils, bandes-son… : présents dans la bibliothèque, mais pas des jeux à proprement parler. */
const JUNK = /\b(beta|playtest|public test|test server|pts|demo|prologue|dedicated server|server|sdk|editor|toolkit|tools?|benchmark|soundtrack|ost|artbook|art book|wallpaper|launcher|vr mod|bonus content|dlc|season pass|trailer|teaser)\b/i;

/** Titre sans mention d'édition ni « classic »/« legacy » : sert à repérer deux éditions d'un même jeu. */
const LEGACY = /(?:\s*[:\-–—(]\s*|\s+)(?:classic|legacy|original|redux|reloaded|enhanced|remastered|remaster|definitive|anniversary|hd)(?:\s+(?:edition|version))?\s*\)?\s*$/i;
const familyKey = (name) => {
  let t = baseTitles(name).at(-1) ?? name;
  for (let i = 0; i < 2; i++) t = t.replace(LEGACY, '').trim() || t;
  return normalize(t.replace(/[™®©]/g, ''));
};

/**
 * Jeux jamais lancés qui ont du sens pour la pile de la honte :
 * - pas une bêta, une démo, un serveur, un outil… (JUNK) ;
 * - pas l'autre édition d'un jeu auquel le joueur a joué (vendu avec le remaster, le classique…) ;
 * - de préférence un jeu que quelqu'un d'autre de la bande a lancé : c'est la preuve que c'est un vrai jeu.
 * Exporté pour les tests.
 */
export function shameCandidates(p, linked = []) {
  const playedFamilies = new Set(p.steam.games.filter((g) => g.minutes > 0).map((g) => familyKey(g.name)));
  const never = p.steam.games.filter((g) => g.minutes === 0 && !JUNK.test(g.name) && !playedFamilies.has(familyKey(g.name)));
  const byOthers = new Set();
  for (const o of linked) if (o.id !== p.id) for (const g of o.steam.games) if (g.minutes >= 60) byOthers.add(g.appid);
  const proven = never.filter((g) => byOthers.has(g.appid));
  return proven.length ? proven : never;
}

/** La pile de la honte : lequel de ces jeux X n'a jamais lancé ? (3 jeux auxquels il a joué au moins 1 h) */
function shame(p, linked) {
  const never = shameCandidates(p, linked);
  const played = p.steam.games.filter((g) => g.minutes >= 60 && !JUNK.test(g.name));
  if (!never.length || played.length < 3) return [];
  return shuffle(never).slice(0, 6).map((g) => {
    const key = `shame:${p.steam.id}:${g.appid}`;
    return {
      type: 'shame', key,
      make: () => {
        const rivals = shuffle(played).slice(0, 3);
        return choiceRound({
          type: 'shame', key, about: p.id,
          prompt: `La pile de la honte : lequel de ces jeux ${p.name} n'a jamais lancé ?`,
          choices: [g.name, ...rivals.map((x) => x.name)],
          info: rivals.map((x) => `${x.name} : ${hoursText(x.minutes)}`).join(' · '),
          revealImage: picture(g),
        });
      },
    };
  });
}

/** Combien d'heures X a sur tel jeu ? (estimation, parmi ses jeux joués au moins 2 h) */
function hours(p) {
  const played = p.steam.games.filter((g) => g.minutes >= 120).sort((a, b) => b.minutes - a.minutes).slice(0, 15);
  return played.map((g) => {
    const key = `hours:${p.steam.id}:${g.appid}`;
    return {
      type: 'hours', key,
      make: () => ({
        kind: 'estimation', bande: 'hours', key, about: p.id,
        prompt: `${g.name} : combien d'heures de jeu au compteur de ${p.name} ?`,
        unit: 'h', year: false, answer: Math.round(g.minutes / 60),
        info: null,
        picture: picture(g), revealPicture: picture(g),
      }),
    };
  });
}

/**
 * Qui a le plus d'heures sur tel jeu ? Jeux joués par au moins 2 joueurs liés, avec un meneur net.
 * Question de groupe : personne ne connaît les heures des autres, donc tout le monde marque.
 */
function mostHours(linked) {
  const byApp = new Map();
  for (const p of linked) for (const g of p.steam.games) {
    if (!byApp.has(g.appid)) byApp.set(g.appid, { game: g, owners: [] });
    byApp.get(g.appid).owners.push({ p, minutes: g.minutes });
  }
  const out = [];
  for (const { game, owners } of byApp.values()) {
    if (owners.length < 2) continue;
    owners.sort((a, b) => b.minutes - a.minutes);
    // Au moins deux joueurs y ont joué, avec un meneur net
    if (owners[0].minutes < 60 || owners[1].minutes <= 0 || owners[0].minutes === owners[1].minutes) continue;
    const winner = owners[0].p;
    const key = `most:${game.appid}`;
    out.push({
      type: 'most', key,
      make: () => {
        const owning = new Set(owners.map((o) => o.p.id));
        const others = [...shuffle(owners.slice(1).map((o) => o.p)), ...shuffle(linked.filter((x) => !owning.has(x.id)))];
        const mins = new Map(owners.map((o) => [o.p.id, o.minutes]));
        const shown = [winner, ...others.slice(0, 3)];
        return choiceRound({
          type: 'most', key, about: null,
          prompt: `Qui a le plus d'heures sur ${game.name} ?`,
          choices: playerChoices(winner, others),
          info: shown.map((x) => `${x.name} : ${mins.has(x.id) ? hoursText(mins.get(x.id)) : 'ne l\'a pas'}`).join(' · '),
          image: picture(game),
        });
      },
    });
  }
  return out;
}

/** Qui a le plus joué ces 2 dernières semaines ? Une seule par partie, question de groupe (tout le monde marque). */
function recent(linked) {
  const rows = linked.map((p) => ({ p, minutes: p.steam.games.reduce((t, g) => t + (g.recent || 0), 0) })).sort((a, b) => b.minutes - a.minutes);
  if (rows[0].minutes < 60 || rows[0].minutes === rows[1].minutes) return [];
  const winner = rows[0].p;
  const key = `recent:${new Date().toISOString().slice(0, 10)}`;
  return [{
    type: 'recent', key,
    make: () => {
      const others = shuffle(rows.slice(1).map((r) => r.p));
      const shown = [winner, ...others.slice(0, 3)];
      const mins = new Map(rows.map((r) => [r.p.id, r.minutes]));
      return choiceRound({
        type: 'recent', key, about: null,
        prompt: 'Qui a le plus joué sur Steam ces 2 dernières semaines ?',
        choices: playerChoices(winner, others),
        info: shown.map((x) => `${x.name} : ${mins.get(x.id) ? hoursText(mins.get(x.id)) : 'rien'}`).join(' · '),
      });
    },
  }];
}

// ---- Questions ajoutées après le premier essai (décidées avec le client le 2026-11-24)

const df = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const dayf = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const pctText = (x) => `${nf.format(Math.round(x * 1000) / 10)} %`;

/** Une manche « qui a le plus / le moins … ? » entre joueurs liés, avec un gagnant net. */
function rankQuestion({ type, key, prompt, rows, highest = true, text, image, revealImage }) {
  const ok = rows.filter((r) => Number.isFinite(r.value));
  if (ok.length < 2) return [];
  ok.sort((a, b) => (highest ? b.value - a.value : a.value - b.value));
  if (ok[0].value === ok[1].value) return [];
  return [{
    type, key,
    make: () => {
      const winner = ok[0].p;
      const others = shuffle(ok.slice(1)).map((r) => r.p);
      const shown = [ok[0], ...ok.slice(1).filter((r) => others.slice(0, 3).includes(r.p))];
      return choiceRound({
        type, key, about: null, prompt,
        choices: playerChoices(winner, others),
        info: shown.map((r) => `${r.p.name} : ${text(r)}`).join(' · '),
        image, revealImage: typeof revealImage === 'function' ? revealImage(ok[0]) : revealImage,
      });
    },
  }];
}

/** Sale phase : un jeu sur lequel X a passé au moins 10 h ces 2 dernières semaines. */
function binge(p) {
  const played = p.steam.games.filter((g) => g.minutes > 0);
  const hot = played.filter((g) => g.recent >= 600).sort((a, b) => b.recent - a.recent)[0];
  if (!hot || played.length < 4) return [];
  const key = `binge:${p.steam.id}:${hot.appid}:${new Date().toISOString().slice(0, 10)}`;
  return [{
    type: 'binge', key,
    make: () => {
      const rivals = shuffle(played.filter((g) => g !== hot).sort((a, b) => b.minutes - a.minutes).slice(0, 10)).slice(0, 3);
      return choiceRound({
        type: 'binge', key, about: p.id,
        prompt: `Il semblerait que ${p.name} soit dans une sale phase : ${hoursText(hot.recent)} de jeu ces 2 dernières semaines. Sur quel jeu ?`,
        choices: [hot.name, ...rivals.map((g) => g.name)],
        info: `${hot.name} : ${hoursText(hot.recent)} en 2 semaines`,
        revealImage: picture(hot),
      });
    },
  }];
}

/** Dernier jeu lancé par X (les fausses propositions sont ses autres jeux récents). */
function lastPlayed(p) {
  const dated = p.steam.games.filter((g) => g.lastPlayed > 0 && g.minutes > 0).sort((a, b) => b.lastPlayed - a.lastPlayed);
  if (dated.length < 4 || dated[0].lastPlayed === dated[1].lastPlayed) return [];
  const last = dated[0];
  const key = `last:${p.steam.id}:${last.appid}:${last.lastPlayed}`;
  return [{
    type: 'last', key,
    make: () => {
      const rivals = shuffle(dated.slice(1, 8)).slice(0, 3);
      return choiceRound({
        type: 'last', key, about: p.id,
        prompt: `À quel jeu ${p.name} a joué en dernier sur Steam ?`,
        choices: [last.name, ...rivals.map((g) => g.name)],
        info: [last, ...rivals].map((g) => `${g.name} : ${dayf.format(new Date(g.lastPlayed * 1000))}`).join(' · '),
        revealImage: picture(last),
      });
    },
  }];
}

/** 100 % : le jeu où X a le plus de succès, face à ses jeux les plus proches du 100 %. */
function perfect(p) {
  const list = (p.steam.achievements ?? []).filter((a) => a.total >= 5).sort((a, b) => b.pct - a.pct);
  if (list.length < 4 || list[0].pct < 0.8 || list[0].pct === list[1].pct) return [];
  const best = list[0];
  const full = best.done === best.total;
  const key = `perfect:${p.steam.id}:${best.appid}`;
  return [{
    type: 'perfect', key,
    make: () => {
      // Les jeux les plus proches du 100 % : plus dur que des jeux à peine commencés
      const rivals = list.slice(1).filter((a) => a.pct < best.pct).slice(0, 3);
      return choiceRound({
        type: 'perfect', key, about: p.id,
        prompt: full ? `Lequel de ces jeux ${p.name} a terminé à 100 % (tous les succès) ?` : `Lequel de ces jeux ${p.name} a le plus complété (en % de succès) ?`,
        choices: [best.game, ...rivals.map((a) => a.game)],
        info: [best, ...rivals].map((a) => `${a.game} : ${a.done}/${a.total} (${pctText(a.pct)})`).join(' · '),
        revealImage: picture({ appid: best.appid, name: best.game }),
      });
    },
  }];
}

/** Succès le plus rare débloqué par chaque joueur (sur ses jeux les plus joués). */
const rarestOf = (p) => (p.steam.achievements ?? []).filter((a) => a.rarest).sort((a, b) => a.rarest.percent - b.rarest.percent)[0] ?? null;
function rarest(linked) {
  const rows = linked.map((p) => ({ p, a: rarestOf(p) })).filter((r) => r.a).map((r) => ({ ...r, value: r.a.rarest.percent }));
  return rankQuestion({
    type: 'rarest', key: `rarest:${rows.map((r) => `${r.a.appid}`).sort().join('-')}`,
    prompt: 'Qui a débloqué le succès le plus rare ?', rows, highest: false,
    text: (r) => `« ${r.a.rarest.name} » (${r.a.game}), ${nf.format(r.a.rarest.percent)} % des joueurs`,
    revealImage: (r) => (r.a.rarest.icon ? { url: r.a.rarest.icon, alt: r.a.rarest.name, icon: true, caption: `${r.a.rarest.name} · ${r.a.game}${r.a.rarest.description ? ` · ${r.a.rarest.description}` : ''}` } : picture({ appid: r.a.appid, name: r.a.game })),
  });
}

/** Plus vieux / plus récent compte Steam (un seul des deux par partie). */
function accountAge(linked) {
  const rows = linked.map((p) => ({ p, value: p.steam.created ?? NaN }));
  const text = (r) => `créé en ${df.format(new Date(r.value * 1000))}`;
  return [
    ...rankQuestion({ type: 'age', key: 'age:old', prompt: 'Qui a le plus vieux compte Steam ?', rows, highest: false, text }),
    ...rankQuestion({ type: 'age', key: 'age:new', prompt: 'Qui a le compte Steam le plus récent ?', rows, highest: true, text }),
  ];
}

/** Plus haut / plus bas niveau Steam. */
function steamLevel(linked) {
  const rows = linked.map((p) => ({ p, value: p.steam.level ?? NaN }));
  const text = (r) => `niveau ${r.value}`;
  return [
    ...rankQuestion({ type: 'level', key: 'level:high', prompt: 'Qui a le plus haut niveau Steam ?', rows, highest: true, text }),
    ...rankQuestion({ type: 'level', key: 'level:low', prompt: 'Qui a le plus petit niveau Steam ?', rows, highest: false, text }),
  ];
}

/** Nombre de jeux possédés : qui en a le plus (groupe), et combien en a X (estimation). */
function library(linked) {
  const rows = linked.map((p) => ({ p, value: p.steam.games.length }));
  return rankQuestion({ type: 'library', key: 'library:most', prompt: 'Qui possède le plus de jeux sur Steam ?', rows, text: (r) => `${r.value} jeux` });
}
function gameCount(p) {
  const n = p.steam.games.length;
  if (n < 5) return [];
  const key = `count:${p.steam.id}:${n}`;
  return [{
    type: 'count', key,
    make: () => ({
      kind: 'estimation', bande: 'count', key, about: p.id,
      prompt: `Combien de jeux ${p.name} possède sur Steam ?`, unit: 'jeux', year: false, answer: n,
      info: 'Sans les jeux prêtés par le partage familial.', picture: null, revealPicture: null,
    }),
  }];
}

/**
 * Depuis quelle année X et Y sont amis sur Steam ? Les deux ne marquent pas : la question n'est posée que
 * s'il y a au moins un autre joueur dans le salon.
 */
function friendship(linked, roomSize) {
  if (roomSize < 3) return [];
  const out = [];
  for (let i = 0; i < linked.length; i++) for (let j = i + 1; j < linked.length; j++) {
    const a = linked[i], b = linked[j];
    const since = a.steam.friendSince?.[b.steam.id] ?? b.steam.friendSince?.[a.steam.id];
    if (!since) continue;
    const key = `friends:${[a.steam.id, b.steam.id].sort().join('-')}`;
    out.push({
      type: 'friends', key,
      make: () => ({
        kind: 'estimation', bande: 'friends', key, about: [a.id, b.id],
        prompt: `Depuis quelle année ${a.name} et ${b.name} sont amis sur Steam ?`, unit: '', year: true,
        answer: new Date(since * 1000).getUTCFullYear(),
        info: `Amis depuis le ${dayf.format(new Date(since * 1000))}`, picture: null, revealPicture: null,
      }),
    });
  }
  return out;
}

/**
 * Tire n questions. Chaque joueur lié est concerné par le même nombre de questions (le reste au hasard) ;
 * si un joueur n'a plus de question possible, ses manches vont à ceux qui en ont eu le moins.
 * Les types sont variés pour chaque joueur, et deux questions de suite ne portent pas sur le même joueur.
 */
export function buildBande(n, used, ctx) {
  const linked = linkedPlayers(ctx);
  const why = bandeUnavailable(ctx);
  if (why) throw new Error(why);

  // Questions possibles, rangées par joueur concerné ; les questions de groupe comptent comme un « joueur » de plus
  const all = new Map(linked.map((p) => [p.id, [...topGame(p), ...shame(p, linked), ...hours(p), ...binge(p), ...lastPlayed(p), ...perfect(p), ...gameCount(p)]]));
  const group = [...mostHours(linked), ...recent(linked), ...rarest(linked), ...accountAge(linked), ...steamLevel(linked), ...library(linked), ...friendship(linked, ctx.players.length)];
  if (group.length) all.set(GROUP, group);
  const slots = [...all.keys()];
  const fresh = (id) => {
    const list = all.get(id).filter((c) => !used.has(`b:${c.key}`));
    return list.length ? list : all.get(id); // tout déjà vu : on recommence
  };

  const quota = new Map();
  shuffle(slots).forEach((id, i) => quota.set(id, Math.floor(n / slots.length) + (i < n % slots.length ? 1 : 0)));
  const got = new Map(slots.map((id) => [id, []]));
  const taken = new Set();
  const draw = (id) => {
    const mine = got.get(id);
    const types = new Map();
    for (const c of fresh(id)) if (!taken.has(c.key) && !taken.has(`${c.type}#`)) (types.get(c.type) ?? types.set(c.type, []).get(c.type)).push(c);
    if (!types.size) return false;
    // Le type le moins utilisé pour ce joueur, au hasard entre ex aequo
    const usedTypes = (t) => mine.filter((r) => r.bande === t).length;
    const t = shuffle([...types.keys()]).sort((a, b) => usedTypes(a) - usedTypes(b))[0];
    const c = shuffle(types.get(t))[0];
    taken.add(c.key);
    if (ONCE.has(c.type)) taken.add(`${c.type}#`); // plus vieux OU plus récent compte, pas les deux
    mine.push(c.make());
    return true;
  };

  const stuck = new Set();
  for (const id of slots) for (let i = 0; i < quota.get(id); i++) if (!draw(id)) { stuck.add(id); break; }
  let missing = n - [...got.values()].reduce((t, l) => t + l.length, 0);
  while (missing > 0) {
    const id = shuffle(slots.filter((x) => !stuck.has(x))).sort((a, b) => got.get(a).length - got.get(b).length)[0];
    if (!id) break;
    if (draw(id)) missing--;
    else stuck.add(id);
  }
  const rounds = [...got.values()].flat();
  for (const r of rounds) used.add(`b:${r.key}`);
  return spreadAbout(rounds);
}

/** Mélange en évitant deux questions de suite sur le même joueur. */
export function spreadAbout(rounds) {
  const adjacent = (l) => l.reduce((c, r, i) => c + (i > 0 && l[i - 1].about === r.about ? 1 : 0), 0);
  let best = shuffle(rounds);
  for (let t = 0; t < 200 && adjacent(best) > 0; t++) {
    const next = shuffle(rounds);
    if (adjacent(next) < adjacent(best)) best = next;
  }
  return best;
}
