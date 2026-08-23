'use strict';

/**
 * Disparador automático de rifas — Gamificación AMPI 2026
 *
 * Revisa cada pocos segundos si alguna rifa programada ya cumplió su hora.
 * El bloqueo real vive en la base (SELECT ... FOR UPDATE dentro de sortear),
 * así que aunque corrieran dos instancias, una rifa se sortea una sola vez.
 */

const { enTransaccion, pool } = require('../db');
const { sortear, rifasVencidas, proximasRifas } = require('./sorteo');

const INTERVALO_MS = 5000;
const AVISOS = [300, 60, 30, 10];   // segundos antes: 5min, 1min, 30s, 10s

let timer = null;
const avisosEnviados = new Map();   // rifa_id -> Set(segundos ya avisados)

/** Emite countdowns a las pantallas conectadas. */
async function emitirCountdowns(io) {
  const proximas = await proximasRifas(pool, 5);
  const ahora = Date.now();

  const payload = proximas.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    premio: r.premio,
    valor: r.valor,
    hora: r.hora,
    patrocinador: r.patrocinador,
    patrocinador_logo: r.patrocinador_logo,
    segundos: Math.max(0, Math.round((new Date(r.hora) - ahora) / 1000)),
  }));

  io.emit('rifas:proximas', payload);

  // Avisos puntuales para que la pantalla haga su animación de tensión.
  for (const r of payload) {
    if (!avisosEnviados.has(r.id)) avisosEnviados.set(r.id, new Set());
    const ya = avisosEnviados.get(r.id);
    for (const marca of AVISOS) {
      if (r.segundos <= marca && !ya.has(marca)) {
        ya.add(marca);
        io.emit('rifa:aviso', { rifa: r, faltan: marca });
      }
    }
  }
}

/** Ejecuta las rifas que ya vencieron. */
async function ejecutarVencidas(io) {
  const vencidas = await rifasVencidas(pool);

  for (const v of vencidas) {
    try {
      io.emit('rifa:iniciada', { id: v.id, nombre: v.nombre, premio: v.premio });

      const resultado = await enTransaccion((client) =>
        sortear(client, v.id, { actor: 'programado' })
      );

      if (resultado.ok) {
        io.emit('rifa:ganador', {
          rifa: {
            id: resultado.rifa.id,
            nombre: resultado.rifa.nombre,
            premio: resultado.rifa.premio,
            valor: resultado.rifa.valor,
          },
          ganadores: resultado.ganadores.map((g) => ({
            posicion: g.posicion,
            nombre: g.nombre,
            apellido: g.apellido,
            folio: g.folio,
          })),
          estadisticas: resultado.estadisticas,
        });
        console.log(`[rifa] "${v.premio}" sorteada — ${resultado.ganadores.length} ganador(es)`);
      } else {
        io.emit('rifa:sin_participantes', { id: v.id, motivo: resultado.motivo });
        console.warn(`[rifa] ${v.id} no se pudo sortear: ${resultado.motivo}`);
        if (resultado.motivo === 'sin_participantes') {
          // La dejamos pendiente pero sin auto, para que el admin decida.
          await pool.query(`UPDATE rifas SET auto = false WHERE id = $1`, [v.id]);
        }
      }
      avisosEnviados.delete(v.id);
    } catch (err) {
      console.error(`[rifa] error sorteando ${v.id}:`, err.message);
    }
  }
}

function iniciar(io) {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      await emitirCountdowns(io);
      await ejecutarVencidas(io);
    } catch (err) {
      console.error('[scheduler]', err.message);
    }
  }, INTERVALO_MS);
  console.log('[scheduler] activo — revisando rifas cada 5s');
}

function detener() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { iniciar, detener, emitirCountdowns, ejecutarVencidas };
