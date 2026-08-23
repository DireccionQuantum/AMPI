'use strict';

/**
 * Marca e identidad visual — Gamificación AMPI 2026
 *
 * Los logos se guardan en PostgreSQL, no en disco: Railway recrea el
 * sistema de archivos en cada despliegue y un logo subido se perdería.
 *
 * Claves reconocidas:
 *   logo_evento         Logo del cliente (AMPI), fondos claros
 *   logo_agencia        Logo Quantum para fondos claros
 *   logo_agencia_claro  Logo Quantum para fondos oscuros
 */

const express = require('express');
const crypto = require('crypto');
const { soloAdmin } = require('../middleware/auth');

const CLAVES = ['logo_evento', 'logo_agencia', 'logo_agencia_claro'];
const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_BYTES = 2 * 1024 * 1024;   // 2 MB: de sobra para un logo

module.exports = function marcaRoutes(db) {
  const router = express.Router();

  // ---------- Servir un logo (público: lo usan todas las pantallas) ----------
  router.get('/:clave', async (req, res, next) => {
    try {
      if (!CLAVES.includes(req.params.clave)) {
        return res.status(404).json({ error: 'Recurso no encontrado' });
      }
      const { rows } = await db.query(
        'SELECT mime, datos, actualizado FROM marca WHERE clave = $1',
        [req.params.clave]
      );
      if (!rows.length) return res.status(404).json({ error: 'Sin logo cargado' });

      const r = rows[0];
      // ETag por fecha de actualización: el navegador sólo lo baja al cambiar.
      const etag = '"' + crypto.createHash('md5')
        .update(req.params.clave + r.actualizado.toISOString()).digest('hex') + '"';
      if (req.headers['if-none-match'] === etag) return res.status(304).end();

      res.setHeader('Content-Type', r.mime);
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      res.setHeader('ETag', etag);
      res.send(r.datos);
    } catch (err) {
      next(err);
    }
  });

  return router;
};

// ---------- Rutas de administración (se montan bajo /api/admin) ----------
module.exports.admin = function marcaAdmin(db) {
  const router = express.Router();

  // Qué logos hay cargados
  router.get('/', soloAdmin, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT clave, mime, bytes, nombre_orig, actualizado FROM marca`);
      const mapa = {};
      for (const c of CLAVES) {
        const r = rows.find((x) => x.clave === c);
        mapa[c] = r
          ? { cargado: true, mime: r.mime, bytes: r.bytes,
              nombre: r.nombre_orig, actualizado: r.actualizado }
          : { cargado: false };
      }
      res.json(mapa);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Subida por base64 en JSON: evita meter multer al proyecto para un
   * caso de uso de tres imágenes que se cargan una vez.
   */
  router.put('/:clave', soloAdmin, async (req, res, next) => {
    try {
      const clave = req.params.clave;
      if (!CLAVES.includes(clave)) {
        return res.status(400).json({ error: 'Ese espacio de logo no existe' });
      }

      const { datos, nombre } = req.body || {};
      if (typeof datos !== 'string' || !datos.startsWith('data:')) {
        return res.status(422).json({ error: 'Envía la imagen como data URL' });
      }

      const m = datos.match(/^data:([\w/+.-]+);base64,(.+)$/);
      if (!m) return res.status(422).json({ error: 'Formato de imagen no reconocido' });

      const mime = m[1].toLowerCase();
      if (!MIMES.includes(mime)) {
        return res.status(422).json({
          error: 'Usa PNG, JPG, WEBP o SVG. Para logos, PNG con fondo transparente es lo mejor.',
        });
      }

      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length) return res.status(422).json({ error: 'La imagen llegó vacía' });
      if (buf.length > MAX_BYTES) {
        return res.status(413).json({
          error: `La imagen pesa ${(buf.length / 1048576).toFixed(1)} MB. El máximo es 2 MB.`,
        });
      }

      await db.query(
        `INSERT INTO marca (clave, mime, datos, nombre_orig, bytes, actor)
              VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (clave) DO UPDATE
            SET mime = EXCLUDED.mime, datos = EXCLUDED.datos,
                nombre_orig = EXCLUDED.nombre_orig, bytes = EXCLUDED.bytes,
                actualizado = now(), actor = EXCLUDED.actor`,
        [clave, mime, buf, String(nombre || '').slice(0, 120),
         buf.length, req.session.usuario.email]
      );

      await db.query(
        `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1,'marca',$2)`,
        [req.session.usuario.email, JSON.stringify({ clave, bytes: buf.length })]
      );

      res.json({ ok: true, clave, bytes: buf.length });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:clave', soloAdmin, async (req, res, next) => {
    try {
      if (!CLAVES.includes(req.params.clave)) {
        return res.status(400).json({ error: 'Ese espacio de logo no existe' });
      }
      await db.query('DELETE FROM marca WHERE clave = $1', [req.params.clave]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

module.exports.CLAVES = CLAVES;
