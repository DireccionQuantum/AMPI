'use strict';

/**
 * Tiempo real — Gamificación AMPI 2026
 *
 * Salas:
 *   asistente:<qr_id>  — panel personal, recibe sus propios puntos
 *   tablero            — dashboard admin y pantalla de proyección
 */

const { metricas } = require('../services/puntos');
const { proximasRifas } = require('../services/sorteo');
const { parseQr } = require('../services/vinculacion');

function configurar(io, db) {
  io.on('connection', (socket) => {
    // El panel del asistente se suscribe a su propio canal.
    socket.on('asistente:seguir', (qr) => {
      const qrId = parseQr(qr);
      if (!qrId) return;
      // Un socket sólo escucha un asistente a la vez.
      for (const sala of socket.rooms) {
        if (sala.startsWith('asistente:')) socket.leave(sala);
      }
      socket.join(`asistente:${qrId}`);
    });

    // El dashboard y la pantalla piden el estado inicial al conectarse.
    socket.on('tablero:entrar', async () => {
      socket.join('tablero');
      try {
        socket.emit('stats:update', await metricas(db));
        socket.emit('rifas:proximas', await proximasRifas(db, 5));
      } catch (err) {
        console.error('[socket] tablero:entrar', err.message);
      }
    });

    socket.on('error', (err) => {
      console.error('[socket]', err && err.message);
    });
  });

  console.log('[socket] listo');
}

module.exports = { configurar };
