import crypto from 'node:crypto';
import { Room, cleanName } from './room.js';

// Pas de I ni O pour éviter les confusions avec 1 et 0
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
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
    socket.data = {};
    if (room.players.size === 0) {
      room.destroy();
      this.rooms.delete(room.code);
    }
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
        try {
          const res = handler(payload && typeof payload === 'object' ? payload : {});
          reply(res ?? { ok: true });
        } catch (err) {
          reply({ error: err.message || 'Erreur inattendue' });
        }
      });
    };

    const hostOnly = (fn) => (payload) => {
      const room = this.roomOf(socket);
      if (!room) throw new Error("Tu n'es dans aucun salon");
      if (room.hostId !== socket.data.playerId) throw new Error("Seul l'hôte peut faire ça");
      return fn(room, payload);
    };

    // Synchronisation d'horloge : le client mesure l'aller-retour et en déduit son décalage
    socket.on('time:ping', (_payload, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    on('room:create', ({ name }) => {
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      this.leave(socket);
      const room = new Room(this.io, this.newCode());
      this.rooms.set(room.code, room);
      const p = room.addPlayer(n, socket);
      return { ok: true, code: room.code, token: p.token, playerId: p.id };
    });

    on('room:join', ({ code, name }) => {
      const n = cleanName(name);
      if (!n) throw new Error('Choisis un pseudo');
      const room = this.rooms.get(String(code || '').trim().toUpperCase());
      if (!room) throw new Error('Salon introuvable');
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

    on('room:settings', hostOnly((room, s) => room.updateSettings(s)));
    on('room:kick', hostOnly((room, { playerId }) => {
      if (playerId === socket.data.playerId) throw new Error('Tu ne peux pas te retirer toi-même');
      room.removePlayer(playerId, 'kick');
    }));
    on('game:start', hostOnly((room) => room.start()));
    on('game:skip', hostOnly((room) => room.skip()));
    on('game:stop', hostOnly((room) => room.stop()));
    on('room:reset-totals', hostOnly((room) => room.resetTotals()));
    on('game:ban-cover', hostOnly((room) => room.banCover()));
    on('game:pause', hostOnly((room) => room.pause()));
    on('game:resume', hostOnly((room) => room.resume()));
    on('game:report', hostOnly((room, payload) => room.report(socket.data.playerId, payload)));

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
      const room = this.roomOf(socket);
      if (room) room.detach(socket);
    });
  }
}
