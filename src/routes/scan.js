'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { enTransaccion } = require('../db');
const { parseQr } = require('../services/vinculacion');
const { limpiarCodigo } = require('../services/sesion');
const { registrarEscaneo, metricas } = require('../services/puntos');
const { soloExpositor, limiteLoginExpositor, verificarPassword } = require('../middleware/auth');

module.exports = function scanRoutes(db, io) {
  const router = express.Router();

  // Un módulo muy activo puede escanear rápido; el tope es generoso
  // pero corta cualquier script automatizado.
  const limiteScan = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados escaneos seguidos. Espera un momento.' },
  });

  // ---- Login del expositor ----
  // Dos formas, ambas válidas:
  //   1. Código de módulo desde la dirección general /scan (la habitual).
  //   2. Liga directa /s/<token> + PIN (las ya repartidas siguen sirviendo).
  router.post('/login', limiteLoginExpositor, async (req, res, next) => {
    try {
      const { token, pin, codigo } = req.body || {};

      let expo = null;

      // --- Camino 1: código de módulo ---
      if (codigo) {
        const limpio = limpiarCodigo(codigo);
        if (!limpio) {
          return res.status(400).json({
            error: 'El código son 6 caracteres, como los del gafete de tu módulo.',
          });
        }
        const { rows } = await db.query(
          `SELECT id, nombre, empresa, puntos, pin_hash, activo
             FROM expositores WHERE codigo = $1`,
          [limpio]
        );
        expo = rows[0] || null;
        if (!expo) return res.status(401).json({ error: 'Código no reconocido. Revísalo con la organización.' });
        if (!expo.activo) return res.status(403).json({ error: 'Este módulo está desactivado' });

        req.session.expositor = { id: expo.id, nombre: expo.nombre, puntos: expo.puntos };
        return res.json({
          ok: true,
          expositor: { id: expo.id, nombre: expo.nombre, empresa: expo.empresa, puntos: expo.puntos },
        });
      }

      // --- Camino 2: liga directa /s/<token> ---
      // El token son 24 hex aleatorios: es en sí mismo la credencial, del
      // mismo modo que el código de 6 caracteres. Si viene por la liga, no
      // se le pide nada más. Si además mandan PIN, se valida (compatible
      // con clientes viejos).
      if (token && typeof token === 'string') {
        const { rows } = await db.query(
          `SELECT id, nombre, empresa, puntos, pin_hash, activo
             FROM expositores WHERE token = $1`,
          [token.trim()]
        );
        expo = rows[0] || null;
      }

      if (!token || typeof token !== 'string') {
        return res.status(401).json({
          error: 'Escribe el código de 6 caracteres de tu módulo.',
        });
      }
      if (!expo) return res.status(401).json({ error: 'Módulo no encontrado' });
      if (!expo.activo) return res.status(403).json({ error: 'Este módulo está desactivado' });

      if (pin != null && pin !== '') {
        const ok = await verificarPassword(pin, expo.pin_hash);
        if (!ok) return res.status(401).json({ error: 'PIN incorrecto' });
      }

      req.session.expositor = { id: expo.id, nombre: expo.nombre, puntos: expo.puntos };
      res.json({
        ok: true,
        expositor: { id: expo.id, nombre: expo.nombre, empresa: expo.empresa, puntos: expo.puntos },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res) => {
    if (req.session) delete req.session.expositor;
    res.json({ ok: true });
  });

  router.get('/sesion', (req, res) => {
    if (!req.session || !req.session.expositor) return res.status(401).json({ ok: false });
    res.json({ ok: true, expositor: req.session.expositor });
  });

  // ---- El endpoint crítico: registrar un escaneo ----
  router.post('/', limiteScan, soloExpositor, async (req, res, next) => {
    try {
      const qrId = parseQr((req.body || {}).qr);
      if (!qrId) {
        return res.status(400).json({
          resultado: 'invalido',
          mensaje: 'Ese código no es del evento',
        });
      }

      const expositorId = req.session.expositor.id;

      const r = await enTransaccion((client) =>
        registrarEscaneo(client, { qrId, expositorId, origen: 'scanner' })
      );

      if (r.resultado === 'expositor') {
        return res.status(403).json({
          resultado: 'expositor',
          mensaje: 'Tu módulo está desactivado',
        });
      }

      if (r.resultado === 'duplicado') {
        return res.status(200).json({
          resultado: 'duplicado',
          mensaje: r.asistente.nombre
            ? `${r.asistente.nombre} ya visitó este módulo`
            : 'Este código ya pasó por aquí',
          asistente: {
            nombre: r.asistente.nombre,
            puntos: r.asistente.puntos,
            boletos: r.asistente.boletos,
          },
        });
      }

      // Aviso en vivo al dashboard y a la pantalla de proyección.
      io.emit('scan:nuevo', {
        expositor: r.expositor.nombre,
        asistente: r.asistente.nombre || 'Sin identificar',
        puntos: r.puntosGanados,
      });
      io.emit('stats:update', await metricas(db));

      // Aviso al panel del propio asistente, si lo tiene abierto.
      io.to(`asistente:${qrId}`).emit('asistente:update', {
        puntos: r.asistente.puntos,
        boletos: r.asistente.boletos,
        modulos: r.asistente.modulos,
        ultimo: r.expositor.nombre,
      });

      res.json({
        resultado: 'ok',
        mensaje: r.asistente.nombre
          ? `${r.asistente.nombre} +${r.puntosGanados}`
          : `Punto registrado +${r.puntosGanados}`,
        requiereDatos: r.requiereDatos,
        qr_id: qrId,
        asistente: {
          nombre: r.asistente.nombre,
          puntos: r.asistente.puntos,
          boletos: r.asistente.boletos,
          modulos: r.asistente.modulos,
        },
        boletosNuevos: r.boletosNuevos.map((b) => b.folio),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- Resumen del propio módulo, para la pantalla del expositor ----
  router.get('/resumen', soloExpositor, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT COUNT(*) AS visitas,
                COUNT(*) FILTER (WHERE creado_en > now() - interval '1 hour') AS ultima_hora,
                MAX(creado_en) AS ultima
           FROM escaneos WHERE expositor_id = $1`,
        [req.session.expositor.id]
      );
      res.json({
        visitas: Number(rows[0].visitas),
        ultima_hora: Number(rows[0].ultima_hora),
        ultima: rows[0].ultima,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
