import crypto from 'node:crypto';
import { gameImage } from '../steam.js';

/**
 * « Ta bande » : questions tirées des profils Steam liés par les joueurs du salon.
 *
 * Chaque question porte sur un joueur (`about`) : il peut répondre, mais ne marque pas dessus (voir
 * Room.endQuestion). Les questions tournent entre les joueurs liés pour que chacun soit concerné autant
 * de fois que les autres. Les manches réutilisent les types existants : `qcm` (choix) et `estimation`.
 *
 * ctx.players : joueurs du salon dont le profil Steam est public, [{ id, name, steam: { id, games } }].
 */
export const MIN_LINKED = 2;

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

/** La pile de la honte : lequel de ces jeux X n'a jamais lancé ? (3 jeux auxquels il a joué au moins 1 h) */
function shame(p) {
  const never = p.steam.games.filter((g) => g.minutes === 0);
  const played = p.steam.games.filter((g) => g.minutes >= 60);
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
 * Qui a le plus d'heures sur tel jeu ? Jeux possédés par au moins 2 joueurs liés, avec un meneur net.
 * La question porte sur le meneur (c'est lui qui ne marque pas).
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
    if (owners[0].minutes < 60 || owners[0].minutes === owners[1].minutes) continue;
    const winner = owners[0].p;
    const key = `most:${game.appid}`;
    out.push({
      type: 'most', key, about: winner.id,
      make: () => {
        const owning = new Set(owners.map((o) => o.p.id));
        const others = [...shuffle(owners.slice(1).map((o) => o.p)), ...shuffle(linked.filter((x) => !owning.has(x.id)))];
        const mins = new Map(owners.map((o) => [o.p.id, o.minutes]));
        const shown = [winner, ...others.slice(0, 3)];
        return choiceRound({
          type: 'most', key, about: winner.id,
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

/** Qui a le plus joué ces 2 dernières semaines ? Une seule par partie, sur le meneur. */
function recent(linked) {
  const rows = linked.map((p) => ({ p, minutes: p.steam.games.reduce((t, g) => t + (g.recent || 0), 0) })).sort((a, b) => b.minutes - a.minutes);
  if (rows[0].minutes < 60 || rows[0].minutes === rows[1].minutes) return [];
  const winner = rows[0].p;
  const key = `recent:${new Date().toISOString().slice(0, 10)}`;
  return [{
    type: 'recent', key, about: winner.id,
    make: () => {
      const others = shuffle(rows.slice(1).map((r) => r.p));
      const shown = [winner, ...others.slice(0, 3)];
      const mins = new Map(rows.map((r) => [r.p.id, r.minutes]));
      return choiceRound({
        type: 'recent', key, about: winner.id,
        prompt: 'Qui a le plus joué sur Steam ces 2 dernières semaines ?',
        choices: playerChoices(winner, others),
        info: shown.map((x) => `${x.name} : ${mins.get(x.id) ? hoursText(mins.get(x.id)) : 'rien'}`).join(' · '),
      });
    },
  }];
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

  // Questions possibles, rangées par joueur concerné
  const all = new Map(linked.map((p) => [p.id, [...topGame(p), ...shame(p), ...hours(p)]]));
  for (const c of [...mostHours(linked), ...recent(linked)]) all.get(c.about).push(c);
  const fresh = (id) => {
    const list = all.get(id).filter((c) => !used.has(`b:${c.key}`));
    return list.length ? list : all.get(id); // tout déjà vu : on recommence
  };

  const quota = new Map();
  shuffle(linked).forEach((p, i) => quota.set(p.id, Math.floor(n / linked.length) + (i < n % linked.length ? 1 : 0)));
  const got = new Map(linked.map((p) => [p.id, []]));
  const taken = new Set();
  const draw = (id) => {
    const mine = got.get(id);
    const types = new Map();
    for (const c of fresh(id)) if (!taken.has(c.key)) (types.get(c.type) ?? types.set(c.type, []).get(c.type)).push(c);
    if (!types.size) return false;
    // Le type le moins utilisé pour ce joueur, au hasard entre ex aequo
    const usedTypes = (t) => mine.filter((r) => r.bande === t).length;
    const t = shuffle([...types.keys()]).sort((a, b) => usedTypes(a) - usedTypes(b))[0];
    const c = shuffle(types.get(t))[0];
    taken.add(c.key);
    mine.push(c.make());
    return true;
  };

  const stuck = new Set();
  for (const p of linked) for (let i = 0; i < quota.get(p.id); i++) if (!draw(p.id)) { stuck.add(p.id); break; }
  let missing = n - [...got.values()].reduce((t, l) => t + l.length, 0);
  while (missing > 0) {
    const id = shuffle(linked.map((p) => p.id).filter((x) => !stuck.has(x))).sort((a, b) => got.get(a).length - got.get(b).length)[0];
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
