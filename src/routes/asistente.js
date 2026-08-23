'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { enTransaccion } = require('../db');
const v = require('../services/vinculacion');
const sesion = require('../services/sesion');
const { progresoDe } = require('../services/puntos');
const { proximasRifas } = require('../services/sorteo');

module.exports = function asistenteRoutes(db, io) {
  const router = express.Router();

  const limite = rateLimit({
    windowMs: 60 * 1000, max: 40,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera un minuto.' },
  });

  const limiteRecuperar = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiados intentos. Acércate al módulo de registro.' },
  });

  function conQr(req, res, next) {
    const qr = v.parseQr(req.params.qr_id);
    if (!qr) return res.status(400).json({ error: 'Código no válido' });
    req.qrId = qr;
    next();
  }

  // ---------- Registro nuevo (estación del stand o autoservicio) ----------
  router.post('/registro', limite, async (req, res, next) => {
    try {
      // Sólo el personal autenticado puede reemitir el acceso de alguien
      // que ya está registrado. Si no, bastaría con conocer un teléfono
      // ajeno para quedarse con su cuenta y sus boletos.
      const esStaff = !!(req.session && req.session.usuario &&
        ['admin', 'staff'].includes(req.session.usuario.rol));

      const r = await enTransaccion(async (client) => {
        const reg = await v.registrarNuevo(client, req.body || {});
        if (!reg.ok) return reg;
        if (reg.yaExistia && !esStaff) return reg;   // sin credenciales

        const id = reg.id || (await client.query(
          'SELECT id FROM asistentes WHERE qr_id = $1', [reg.qr_id])).rows[0].id;
        const cred = await sesion.emitirCredenciales(client, id);
        return { ...reg, token: cred.token, codigo: cred.codigo };
      });

      if (!r.ok) return res.status(422).json({ errores: r.errores });

      if (r.yaExistia && !esStaff) {
        return res.status(409).json({
          error: 'Ese teléfono ya está registrado. Recupera tu acceso con tu código de 6 caracteres.',
          recuperar: true,
        });
      }

      const estado = await v.consultarEstado(db, r.qr_id);
      res.json({
        ok: true,
        yaExistia: r.yaExistia,
        qr_id: r.qr_id,
        token: r.token,
        codigo: r.codigo,
        nombre: estado.nombre,
        apellido: estado.apellido,
        puntos: estado.puntos,
        boletos: estado.boletos,
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Completar datos de alguien que llegó por escaneo ----------
  router.get('/registro/:qr_id', limite, conQr, async (req, res, next) => {
    try {
      res.json(await v.consultarEstado(db, req.qrId));
    } catch (err) { next(err); }
  });

  router.post('/registro/:qr_id', limite, conQr, async (req, res, next) => {
    try {
      const r = await enTransaccion(async (client) => {
        const vin = await v.vincularDatos(client, req.qrId, req.body || {});
        if (!vin.ok) return vin;
        const cred = await sesion.emitirCredenciales(client, vin.id);
        return { ...vin, token: cred.token, codigo: cred.codigo };
      });

      if (r.ok) {
        io.emit('asistente:vinculado', { qr_id: req.qrId, nombre: r.datos.nombre });
        return res.json({ ok: true, token: r.token, codigo: r.codigo, ...r.datos });
      }
      if (r.telefonoEnUso) {
        return res.status(409).json({
          error: 'Ese teléfono ya está registrado. Recupera tu sesión con tu código.',
          recuperar: true,
        });
      }
      if (r.yaVerificado) {
        return res.status(409).json({ error: 'Este código ya está registrado', ...r.datos });
      }
      if (r.noEncontrado) {
        return res.status(404).json({ error: 'No encontramos este código' });
      }
      res.status(422).json({ errores: r.errores });
    } catch (err) { next(err); }
  });

  // ---------- Panel del asistente ----------
  router.get('/panel/:qr_id', limite, conQr, async (req, res, next) => {
    try {
      const estado = await v.consultarEstado(db, req.qrId);
      if (!estado.existe) return res.status(404).json({ error: 'Código no encontrado' });

      const [modulos, rifas] = await Promise.all([
        progresoDe(db, req.qrId),
        proximasRifas(db, 6),
      ]);

      const visitados = modulos.filter((m) => m.visitado).length;
      res.json({
        ...estado,
        progreso: { visitados, total: modulos.length },
        modulos,
        rifas: rifas.map((r) => ({
          id: r.id, nombre: r.nombre, premio: r.premio, valor: r.valor,
          hora: r.hora, num_ganadores: r.num_ganadores,
          patrocinador: r.patrocinador, patrocinador_logo: r.patrocinador_logo,
        })),
      });
    } catch (err) { next(err); }
  });

  // ---------- Sesión: restaurar por token de la liga ----------
  router.get('/sesion/:token', async (req, res, next) => {
    try {
      const a = await sesion.porToken(db, req.params.token);
      if (!a) return res.status(404).json({ error: 'Liga no válida' });
      res.json({ ok: true, qr_id: a.qr_id, nombre: a.nombre, codigo: a.codigo_corto });
    } catch (err) { next(err); }
  });

  // ---------- Sesión: recuperar por teléfono + código corto ----------
  router.post('/recuperar', limiteRecuperar, async (req, res, next) => {
    try {
      const r = await enTransaccion((client) =>
        sesion.recuperar(client, req.body || {}, v.parseTelefono)
      );

      if (r.ok) {
        const { rows } = await db.query(
          'SELECT qr_id FROM asistentes WHERE telefono = $1',
          [v.parseTelefono(req.body.telefono)]
        );
        return res.json({
          ok: true, token: r.token, codigo: r.codigo,
          nombre: r.nombre, qr_id: rows[0] && rows[0].qr_id,
        });
      }

      const mensajes = {
        telefono_invalido: 'Escribe tu teléfono a 10 dígitos',
        codigo_invalido: 'El código son 6 caracteres, como K7M2Q9',
        no_coincide: 'El teléfono y el código no coinciden',
        bloqueado: `Demasiados intentos. Espera ${r.minutos} minutos o acércate al módulo de registro.`,
      };
      res.status(r.motivo === 'bloqueado' ? 429 : 401).json({
        error: mensajes[r.motivo] || 'No pudimos recuperar tu sesión',
        restantes: r.restantes,
      });
    } catch (err) { next(err); }
  });

  return router;
};
