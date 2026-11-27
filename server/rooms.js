import crypto from 'node:crypto';
import { stats } from './stats.js';
import { cleanLook, defaultLook, photoOf } from './avatars.js';
import { Room, cleanName } from './room.js';
import { Daily, startDaily } from './daily.js';
import { Live } from './live.js';
import { Challenges, challengeModes, startChallenge, CHALLENGE_ROUNDS, CHALLENGE_DURATIONS, CHALLENGE_DEFAULTS, CHALLENGE_DAYS } from './challenges.js';

// Pas de I ni O pour éviter les confusions avec 1 et 0
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

export class RoomManager {
  constructor(io, { auth } = {}) {
    this.io = io;
    this.auth = auth; // comptes joueurs (facultatifs) : voir auth.js
    this.rooms = new Map();
    this.pins = new Map(); // code à 4 chiffres affiché par un écran télé en attente → socket
    this.daily = new Daily(); // défi du jour (voir daily.js)
    this.challenges = new Challenges(); // défis entre potes (voir challenges.js)
    this.live = new Live(this); // quiz en direct (voir live.js)
    setInterval(() => this.sweep(), 60_000).unref();
  }

  newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  /** Supprime les salons vides depuis trop longtemps. */
  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.waiting) continue; // salle d'attente du direct
      if (room.players.size === 0 || (room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS)) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }

  roomOf(socket) {
    return socket.data.code ? this.rooms.get(socket.data.code) : undefined;
  }

  /** Quitte volontairement le salon courant (le joueur est retiré). */
  leave(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    room.removePlayer(socket.data.playerId);
    socket.leave(room.channel);
    socket.data = { user: socket.data.user ?? null }; // le compte reste connecté hors du salon
    if (room.players.size === 0 && !room.waiting) {
      room.destroy();
      this.rooms.delete(room.code);
    }
  }

  /** Code à 4 chiffres pour un écran télé en attente d'appairage. */
  newPin(socket) {
    if (socket.data.pin) this.pins.delete(socket.data.pin);
    for (;;) {
      const pin = String(crypto.randomInt(1000, 10000));
      if (!this.pins.has(pin)) {
        this.pins.set(pin, socket);
        socket.data.pin = pin;
        return pin;
      }
    }
  }

  screenRoom(socket) {
    return socket.data.screenOf ? this.rooms.get(socket.data.screenOf) : undefined;
  }

  /** Événements d'un écran télé (appairage avec un salon). */
  screenEvents(socket, on) {
    on('screen:hello', () => {
      this.screenRoom(socket)?.detachScreen(socket);
      socket.data.screenOf = null;
      return { ok: true, pin: this.newPin(socket) };
    });
    on('screen:resume', ({ code, token }) => {
      const room = this.rooms.get(String(code || '').trim().toUpperCase());
      if (!room || typeof token !== 'string' || token !== room.screenToken) throw new Error('Écran à rappairer');
      if (socket.data.pin) this.pins.delete(socket.data.pin);
      socket.data.pin = null;
      room.attachScreen(socket);
      return { ok: true, code: room.code };
    });
    on('screen:leave', () => {
      this.screenRoom(socket)?.detachScreen(socket);
      socket.data.screenOf = null;
    });
  }

  handleConnection(socket) {
    // Enregistre un handler avec accusé de réception systématique { ok } ou { error }
    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = {};
        }
        const reply = typeof ack === 'function' ? ack : () => {};
        const fail = (err) => reply({ error: err?.message || 'Erreur inattendue' });
        try {
          const res = handler(payload && typeof payload === 'object' ? payload : {});
          if (res && typeof res.then === 'function') res.then((x) => reply(x ?? { ok: true }), fail);
          else reply(res ?? { ok: true });
        } catch (err) {
          fail(err);
        }
      });
    };

    const hostOnly = (fn) => (payload) => {
      const room = this.roomOf(socket);
      if (!room) throw new Error("Tu n'es dans aucun salon");
      if (room.hostId !== socket.data.playerId) throw new Error("Seul l'hôte peut faire ça");
      return fn(room, payload);
    };

    const inRoom = (fn) => (payload) => {
      const room = this.roomOf(socket);
      if (!room) throw new Error("Tu n'es dans aucun salon");
      return fn(room, payload);
    };

    // Synchronisation d'horloge : le client mesure l'aller-retour et en déduit son décalage
    socket.on('time:ping', (_payload, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    this.screenEvents(socket, on);
    const dropScreen = () => {
      if (socket.data.pin) this.pins.delete(socket.data.pin);
      this.screenRoom(socket)?.detachScreen(socket);
    };

    on('room:create', ({ name, look }) => {
      if (socket.data.look == null) socket.data.look = cleanLook(look) ?? '';
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      this.leave(socket);
      const room = new Room(this.io, this.newCode());
      this.rooms.set(room.code, room);
      const p = room.addPlayer(n, socket);
      return { ok: true, code: room.code, token: p.token, playerId: p.id };
    });

    on('room:join', ({ code, name, look }) => {
      if (socket.data.look == null) socket.data.look = cleanLook(look) ?? '';
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      const room = this.rooms.get(String(code || '').trim().toUpperCase());
      if (!room || room.isDaily || room.isLive) throw new Error('Salon introuvable');
      this.leave(socket);
      const p = room.addPlayer(n, socket);
      return { ok: true, code: room.code, token: p.token, playerId: p.id };
    });

    on('room:resume', ({ code, token }) => {
      const room = this.rooms.get(String(code || '').trim().toUpperCase());
      if (!room) throw new Error("Ce salon n'existe plus");
      const player = [...room.players.values()].find((p) => p.token === token);
      if (!player) throw new Error('Session expirée');
      if (socket.data.code && socket.data.code !== room.code) this.leave(socket);
      room.attach(player, socket);
      return { ok: true, code: room.code, token: player.token, playerId: player.id };
    });

    on('room:leave', () => {
      this.leave(socket);
    });

    // Défi du jour : infos de l'accueil (numéro, série, mon résultat), départ d'une partie solo, classement
    on('daily:info', async () => ({ ok: true, ...(await this.daily.info(socket.data.user ?? null)) }));
    on('daily:start', ({ name }) => {
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      return startDaily(this, socket, n, this.daily);
    });
    // Quiz en direct : prochains créneaux, entrée dans la salle d'attente (voir live.js)
    on('live:info', () => ({ ok: true, ...this.live.info() }));
    on('live:join', ({ name }) => {
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      return this.live.join(socket, n);
    });
    on('daily:board', async () => ({ ok: true, leaderboard: await this.daily.board() }));

    // Défis entre potes : réglages proposés, création (compte), page d'un défi, départ, « Mes défis »
    on('challenge:options', () => ({ ok: true, modes: challengeModes(socket.data.user ?? null), rounds: CHALLENGE_ROUNDS, durations: CHALLENGE_DURATIONS, defaults: CHALLENGE_DEFAULTS, days: CHALLENGE_DAYS }));
    on('challenge:create', async (settings) => ({ ok: true, challenge: this.challenges.summary(await this.challenges.create(socket.data.user ?? null, settings ?? {})) }));
    on('challenge:info', ({ code, device }) => this.challenges.info(code, socket.data.user ?? null, device).then((r) => (r.error ? r : { ok: true, ...r })));
    on('challenge:start', ({ code, name, device }) => {
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      return startChallenge(this, socket, n, this.challenges, code, device);
    });
    on('challenge:list', async ({ device, codes }) => ({ ok: true, list: await this.challenges.list(socket.data.user ?? null, device, Array.isArray(codes) ? codes.slice(0, 30) : []) }));

    // Compte joueur : le navigateur envoie son jeton (à la connexion et à chaque renouvellement).
    // Le serveur le fait vérifier par Supabase ; les droits d'admin ne viennent jamais du navigateur.
    on('auth:set', async ({ token }) => {
      const user = await this.auth?.verify(token).catch(() => null);
      if (!socket.connected) return { ok: false };
      socket.data.user = user ?? null;
      // Image de profil enregistrée sur le compte : elle suit le joueur sur tous ses appareils
      // (sans choix enregistré : la photo Discord/Google, sauf si l'invité avait déjà choisi une image)
      if (user?.look != null) socket.data.look = user.look;
      else if (user?.avatar && !socket.data.look) socket.data.look = defaultLook(user);
      this.roomOf(socket)?.setUser(socket.data.playerId, socket.data.user, user ? socket.data.look ?? null : null);
      if (!user) return { error: 'Session expirée, reconnecte-toi' };
      return { ok: true, user: { name: user.name, avatar: user.avatar, photos: user.photos ?? {}, provider: user.provider, admin: user.admin, nickname: user.nickname ?? null, look: user.look ?? null } };
    });
    // Page Profil : nouveau pseudo. Gardé sur le compte (si connecté) ; appliqué tout de suite dans le salon
    // tant que la partie n'a pas commencé (pendant une partie, il servira au prochain salon).
    on('profile:name', async ({ name }) => {
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      if (socket.data.user) await this.auth.setNickname(socket.data.user, n);
      const room = this.roomOf(socket);
      const renamed = room ? room.renamePlayer(socket.data.playerId, n) : null;
      return { ok: true, name: n, renamed };
    });
    // Stats : les miennes (page Profil), ou celles d'un joueur connecté du même salon (en le touchant)
    on('stats:me', async () => {
      const user = socket.data.user;
      if (!user) throw new Error('Connecte-toi pour avoir tes stats');
      const [st, rating] = await Promise.all([stats.statsOf(user.id), stats.ratingOf(user.id).catch(() => null)]);
      return { ok: true, stats: st, rating };
    });
    // Classement général par cote (saison en cours) : public, comme le classement du défi du jour
    on('rating:board', async () => ({ ok: true, ...(await stats.ratingBoard()), me: socket.data.user?.id ?? null }));
    on('stats:player', inRoom((room, { playerId }) => room.playerStats(String(playerId || ''))));
    // Page Profil : image de profil (galerie, photo du compte, initiale). Invité : retenue sur l'appareil.
    on('profile:avatar', async ({ look }) => {
      const l = cleanLook(look);
      if (l == null) throw new Error('Image inconnue');
      if (l.startsWith('photo') && !photoOf(l, socket.data.user)) throw new Error('Connecte-toi avec Discord ou Google pour utiliser ta photo');
      socket.data.look = l;
      if (socket.data.user) await this.auth.setLook(socket.data.user, l);
      this.roomOf(socket)?.setLook(socket.data.playerId, l);
      return { ok: true, look: l };
    });
    on('auth:clear', () => {
      socket.data.user = null;
      this.roomOf(socket)?.setUser(socket.data.playerId, null);
    });

    on('room:settings', hostOnly((room, s) => room.updateSettings(s)));
    // Mode télé : l'hôte tape le code affiché par l'écran (ou caste, qui passe par room:screen-grant)
    on('room:screen', hostOnly((room, { pin }) => {
      const tv = this.pins.get(String(pin || '').replace(/\D/g, ''));
      if (!tv || !tv.connected) throw new Error("Code d'écran introuvable : vérifie les chiffres affichés sur la télé");
      this.pins.delete(tv.data.pin);
      tv.data.pin = null;
      tv.emit('screen:paired', { code: room.code, token: room.screenToken });
      room.attachScreen(tv);
      return { ok: true };
    }));
    on('room:screen-grant', hostOnly((room) => ({ ok: true, code: room.code, token: room.screenToken })));
    on('room:screen-off', hostOnly((room) => room.dropScreens()));
    on('room:kick', hostOnly((room, { playerId }) => {
      if (playerId === socket.data.playerId) throw new Error('Tu ne peux pas te retirer toi-même');
      room.removePlayer(playerId, 'kick');
    }));
    on('game:start', hostOnly((room) => room.start()));
    on('game:skip', hostOnly((room) => room.skip()));
    on('game:stop', hostOnly((room) => room.stop()));
    on('room:reset-totals', hostOnly((room) => room.resetTotals()));
    // Retirer un jeu, une image, un son : réservé à l'admin (avec les comptes) ; sans comptes (PC), à l'hôte
    on('game:ban-cover', inRoom((room) => {
      if (!room.canModerate(socket.data.playerId)) throw new Error("Réservé à l'admin");
      return room.banCover();
    }));
    on('game:pause', hostOnly((room) => room.pause()));
    on('game:resume', hostOnly((room) => room.resume()));
    // ⚑ Signaler : ouvert à tous les joueurs (seul l'hôte met la partie en pause)
    on('game:report', inRoom((room, payload) => room.report(socket.data.playerId, payload)));

    on('steam:link', ({ profile }) => {
      const room = this.roomOf(socket);
      if (!room) throw new Error("Tu n'es dans aucun salon");
      return room.linkSteam(socket.data.playerId, profile);
    });
    on('steam:unlink', () => {
      const room = this.roomOf(socket);
      if (!room) throw new Error("Tu n'es dans aucun salon");
      room.unlinkSteam(socket.data.playerId);
    });

    on('game:answer', (payload) => {
      const room = this.roomOf(socket);
      if (!room) return { error: "Tu n'es dans aucun salon" };
      return room.answer(socket.data.playerId, payload);
    });

    on('game:word', (payload) => {
      const room = this.roomOf(socket);
      if (!room) return { error: "Tu n'es dans aucun salon" };
      return room.crossword(socket.data.playerId, payload);
    });

    socket.on('disconnect', () => {
      dropScreen();
      const room = this.roomOf(socket);
      if (room) room.detach(socket);
    });
  }
}
