'use strict';

/**
 * Endpoints públicos para la pantalla de proyección.
 *
 * La pantalla vive en una computadora conectada al proyector del salón,
 * sin sesión iniciada. No puede depender de rutas de administración.
 *
 * Todo lo que sale por aquí es visible para el público del evento:
 * nunca teléfonos, nunca folios de terceros, apellidos abreviados.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { metricas } = require('../services/puntos');

module.exports = function publicoRoutes(db) {
  const router = express.Router();

  const limite = rateLimit({
    windowMs: 60 * 1000, max: 60,
    standardHeaders: true, legacyHeaders: false,
  });

  // GET /api/publico/pantalla — todo lo que necesita la proyección.
  router.get('/pantalla', limite, async (req, res, next) => {
    try {
      const [m, rank, rifas, cfg] = await Promise.all([
        metricas(db),
        db.query(`SELECT nombre, apellido, modulos, boletos
                    FROM v_ranking LIMIT 10`),
        // Todas las rifas, no sólo las pendientes: la pantalla muestra
        // el programa completo del día con lo ya sorteado marcado.
        db.query(
          `SELECT r.id, r.nombre, r.premio, r.valor, r.hora, r.estado,
                  p.nombre AS patrocinador, p.logo_url AS patrocinador_logo
             FROM rifas r
             LEFT JOIN patrocinadores p ON p.id = r.patrocinador_id
            WHERE r.estado <> 'cancelada'
            ORDER BY r.hora
            LIMIT 12`),
        db.query(`SELECT clave, valor FROM config
                   WHERE clave IN ('nombre_evento','fecha_evento','evento_sede')`),
      ]);

      const config = {};
      for (const r of cfg.rows) config[r.clave] = r.valor;

      res.json({
        evento: config.nombre_evento || 'AMPI Tijuana 2026',
        fecha: config.fecha_evento || null,
        sede: config.evento_sede || null,
        // Sólo agregados: ni asistentes ni pendientes, que no aportan
        // al público y sí revelan cómo va la operación interna.
        metricas: {
          escaneos: m.escaneos,
          boletos: m.boletos,
          expositores: m.expositores,
        },
        ranking: rank.rows.map((r) => ({
          nombre: r.nombre,
          // Apellido abreviado: se reconoce sin exponer el nombre completo.
          inicial: r.apellido ? String(r.apellido).charAt(0).toUpperCase() : '',
          modulos: Number(r.modulos),
          boletos: Number(r.boletos),
        })),
        rifas: rifas.rows.map((r) => ({
          id: r.id,
          nombre: r.nombre,
          premio: r.premio,
          valor: r.valor,
          hora: r.hora,
          estado: r.estado,
          patrocinador: r.patrocinador,
          patrocinador_logo: r.patrocinador_logo,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/publico/marca — textos de marca para las pantallas sin sesión
  router.get('/marca', limite, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT clave, valor FROM config
          WHERE clave IN ('agencia_nombre','agencia_sitio','agencia_credito',
                          'nombre_evento','evento_sede')`);
      const out = {};
      for (const r of rows) out[r.clave] = r.valor;
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
