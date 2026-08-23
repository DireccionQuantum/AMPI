'use strict';

const express = require('express');
const crypto = require('crypto');
const { enTransaccion } = require('../db');
const { metricas } = require('../services/puntos');
const { sortear, previaElegibles, proximasRifas } = require('../services/sorteo');
const v = require('../services/vinculacion');
const sesion = require('../services/sesion');
const importacion = require('../services/importacion');
const modulo = require('../services/modulo');
const {
  soloAdmin, soloStaff, limiteLogin,
  verificarPassword, hashearPassword,
} = require('../middleware/auth');

module.exports = function adminRoutes(db, io) {
  const router = express.Router();

  // ==================== Autenticación ====================
  router.post('/login', limiteLogin, async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      const { rows } = await db.query(
        `SELECT id, email, nombre, password_hash, rol, activo
           FROM usuarios WHERE email = $1`,
        [String(email || '').trim().toLowerCase()]
      );
      const u = rows[0];
      // Mismo mensaje en ambos casos: no revelamos si el correo existe.
      if (!u || !u.activo || !(await verificarPassword(password, u.password_hash))) {
        return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
      }
      req.session.usuario = { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol };
      res.json({ ok: true, usuario: req.session.usuario });
    } catch (err) { next(err); }
  });

  router.post('/logout', (req, res) => {
    if (req.session) req.session.destroy(() => {});
    res.json({ ok: true });
  });

  router.get('/sesion', (req, res) => {
    if (!req.session || !req.session.usuario) return res.status(401).json({ ok: false });
    res.json({ ok: true, usuario: req.session.usuario });
  });

  // ==================== Métricas ====================
  router.get('/metricas', soloStaff, async (req, res, next) => {
    try { res.json(await metricas(db)); } catch (err) { next(err); }
  });

  router.get('/tablero', soloStaff, async (req, res, next) => {
    try {
      const [m, expo, rank, rifas, pend] = await Promise.all([
        metricas(db),
        db.query(`SELECT * FROM v_expositores LIMIT 50`),
        db.query(`SELECT * FROM v_ranking LIMIT 15`),
        proximasRifas(db, 8),
        db.query(`SELECT * FROM v_pendientes LIMIT 25`),
      ]);
      res.json({
        metricas: m,
        expositores: expo.rows,
        ranking: rank.rows,
        rifas,
        pendientes: pend.rows,
      });
    } catch (err) { next(err); }
  });

  // Escaneos por intervalo, para la gráfica de actividad.
  router.get('/actividad', soloStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(`
        SELECT to_char(date_trunc('hour', creado_en)
                 + interval '15 min' * floor(extract(minute FROM creado_en)/15),
                 'HH24:MI') AS bloque,
               COUNT(*) AS total
          FROM escaneos
         WHERE creado_en > now() - interval '12 hours'
         GROUP BY 1 ORDER BY 1`);
      res.json(rows.map((r) => ({ bloque: r.bloque, total: Number(r.total) })));
    } catch (err) { next(err); }
  });

  // ==================== Expositores ====================
  router.get('/expositores', soloStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(`SELECT * FROM v_expositores`);
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.post('/expositores', soloAdmin, async (req, res, next) => {
    try {
      const { nombre, empresa, contacto, telefono, puntos, orden } = req.body || {};
      if (!nombre || String(nombre).trim().length < 2) {
        return res.status(422).json({ error: 'El módulo necesita un nombre' });
      }
      // PIN de 4 dígitos, fácil de dictar al expositor.
      const pin = String(crypto.randomInt(1000, 10000));
      const token = crypto.randomBytes(12).toString('hex');

      const { rows } = await db.query(
        `INSERT INTO expositores (nombre, empresa, contacto, telefono, pin_hash, token, puntos, orden)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, nombre, token`,
        [String(nombre).trim(), empresa || null, contacto || null, telefono || null,
         await hashearPassword(pin), token, Math.max(1, Number(puntos) || 1), Number(orden) || 0]
      );
      // El PIN se muestra UNA vez: después sólo vive hasheado.
      res.json({ ok: true, expositor: rows[0], pin });
    } catch (err) { next(err); }
  });

  router.patch('/expositores/:id', soloAdmin, async (req, res, next) => {
    try {
      const { nombre, empresa, puntos, activo, orden } = req.body || {};
      const { rows } = await db.query(
        `UPDATE expositores
            SET nombre  = COALESCE($2, nombre),
                empresa = COALESCE($3, empresa),
                puntos  = COALESCE($4, puntos),
                activo  = COALESCE($5, activo),
                orden   = COALESCE($6, orden)
          WHERE id = $1 RETURNING id, nombre, puntos, activo`,
        [req.params.id, nombre || null, empresa || null,
         puntos != null ? Math.max(1, Number(puntos)) : null,
         activo != null ? Boolean(activo) : null,
         orden != null ? Number(orden) : null]
      );
      if (!rows.length) return res.status(404).json({ error: 'Módulo no encontrado' });
      res.json({ ok: true, expositor: rows[0] });
    } catch (err) { next(err); }
  });

  // Liga directa del módulo. El PIN nunca sale por aquí: vive hasheado.
  router.get('/expositores/:id/liga', soloStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        'SELECT id, nombre, token FROM expositores WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Módulo no encontrado' });
      res.json(rows[0]);
    } catch (err) { next(err); }
  });

  router.post('/expositores/:id/pin', soloAdmin, async (req, res, next) => {
    try {
      const pin = String(crypto.randomInt(1000, 10000));
      const { rows } = await db.query(
        `UPDATE expositores SET pin_hash = $2 WHERE id = $1 RETURNING id, nombre`,
        [req.params.id, await hashearPassword(pin)]
      );
      if (!rows.length) return res.status(404).json({ error: 'Módulo no encontrado' });
      res.json({ ok: true, expositor: rows[0], pin });
    } catch (err) { next(err); }
  });

  // ==================== Asistentes ====================
  router.get('/asistentes', soloStaff, async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      const estado = req.query.estado;
      const filtros = [];
      const params = [];

      if (q) {
        params.push(`%${q}%`);
        filtros.push(`(nombre ILIKE $${params.length} OR apellido ILIKE $${params.length}
                       OR telefono ILIKE $${params.length} OR codigo_corto ILIKE $${params.length})`);
      }
      if (estado === 'pendiente' || estado === 'verificado') {
        params.push(estado);
        filtros.push(`estado = $${params.length}`);
      }
      const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

      const { rows } = await db.query(
        `SELECT id, qr_id, codigo_corto, nombre, apellido, telefono, estado,
                modulos, puntos, boletos, premios
           FROM v_asistentes ${where}
          ORDER BY puntos DESC, id ASC LIMIT 200`,
        params
      );
      res.json(rows);
    } catch (err) { next(err); }
  });

  // Reemitir liga para alguien que perdió su sesión (capa 3 de recuperación).
  router.post('/asistentes/reemitir', soloStaff, async (req, res, next) => {
    try {
      const r = await enTransaccion((client) =>
        sesion.reemitirComoStaff(client, (req.body || {}).telefono, v.parseTelefono)
      );
      if (!r.ok) {
        return res.status(r.motivo === 'no_encontrado' ? 404 : 400).json({
          error: r.motivo === 'no_encontrado'
            ? 'No hay nadie registrado con ese teléfono'
            : 'Teléfono no válido',
        });
      }
      res.json(r);
    } catch (err) { next(err); }
  });

  // ==================== Rifas ====================
  router.get('/rifas', soloStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT r.*, p.nombre AS patrocinador,
                (SELECT COUNT(*) FROM ganadores g WHERE g.rifa_id = r.id) AS ganadores
           FROM rifas r
           LEFT JOIN patrocinadores p ON p.id = r.patrocinador_id
          ORDER BY r.hora`);
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.post('/rifas', soloAdmin, async (req, res, next) => {
    try {
      const { nombre, premio, valor, hora, num_ganadores,
              min_modulos, patrocinador_id, auto } = req.body || {};

      if (!premio || String(premio).trim().length < 2) {
        return res.status(422).json({ error: 'Describe el premio' });
      }
      const cuando = new Date(hora);
      if (isNaN(cuando)) return res.status(422).json({ error: 'La hora no es válida' });

      const { rows } = await db.query(
        `INSERT INTO rifas (nombre, premio, valor, hora, num_ganadores,
                            min_modulos, patrocinador_id, auto)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [String(nombre || premio).trim(), String(premio).trim(),
         valor != null && valor !== '' ? Number(valor) : null,
         cuando, Math.max(1, Number(num_ganadores) || 1),
         Math.max(0, Number(min_modulos) || 0),
         patrocinador_id || null, auto !== false]
      );
      io.emit('rifas:cambio');
      res.json({ ok: true, rifa: rows[0] });
    } catch (err) { next(err); }
  });

  router.patch('/rifas/:id', soloAdmin, async (req, res, next) => {
    try {
      const { nombre, premio, valor, hora, num_ganadores, estado, auto } = req.body || {};
      const { rows } = await db.query(
        `UPDATE rifas
            SET nombre = COALESCE($2,nombre), premio = COALESCE($3,premio),
                valor = COALESCE($4,valor), hora = COALESCE($5,hora),
                num_ganadores = COALESCE($6,num_ganadores),
                estado = COALESCE($7,estado), auto = COALESCE($8,auto)
          WHERE id = $1 AND estado <> 'finalizada' RETURNING *`,
        [req.params.id, nombre || null, premio || null,
         valor != null ? Number(valor) : null, hora ? new Date(hora) : null,
         num_ganadores != null ? Number(num_ganadores) : null,
         estado || null, auto != null ? Boolean(auto) : null]
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'No se puede editar: no existe o ya se sorteó' });
      }
      io.emit('rifas:cambio');
      res.json({ ok: true, rifa: rows[0] });
    } catch (err) { next(err); }
  });

  // Cuántos participan ahora mismo — se consulta antes de sortear.
  router.get('/rifas/:id/previa', soloStaff, async (req, res, next) => {
    try {
      const p = await previaElegibles(db, req.params.id);
      if (!p) return res.status(404).json({ error: 'Rifa no encontrada' });
      res.json(p);
    } catch (err) { next(err); }
  });

  // ---- Sorteo manual ----
  router.post('/rifas/:id/sortear', soloAdmin, async (req, res, next) => {
    try {
      const actor = req.session.usuario.email;
      io.emit('rifa:iniciada', { id: Number(req.params.id) });

      const r = await enTransaccion((client) =>
        sortear(client, req.params.id, { actor })
      );

      if (!r.ok) {
        const mensajes = {
          no_existe: 'Rifa no encontrada',
          ya_sorteada: 'Esta rifa ya se sorteó',
          cancelada: 'Esta rifa está cancelada',
          sin_participantes: 'Todavía no hay participantes elegibles',
        };
        io.emit('rifa:sin_participantes', { id: Number(req.params.id), motivo: r.motivo });
        return res.status(409).json({ error: mensajes[r.motivo] || 'No se pudo sortear' });
      }

      io.emit('rifa:ganador', {
        rifa: {
          id: r.rifa.id, nombre: r.rifa.nombre,
          premio: r.rifa.premio, valor: r.rifa.valor,
        },
        ganadores: r.ganadores.map((g) => ({
          posicion: g.posicion, nombre: g.nombre,
          apellido: g.apellido, folio: g.folio,
        })),
        estadisticas: r.estadisticas,
      });

      res.json({ ok: true, ganadores: r.ganadores, estadisticas: r.estadisticas });
    } catch (err) { next(err); }
  });

  // ==================== Ganadores ====================
  router.get('/ganadores', soloStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT g.id, g.posicion, g.entregado, g.creado_en,
                a.nombre, a.apellido, a.telefono, b.folio,
                r.id AS rifa_id, r.premio, r.valor
           FROM ganadores g
           JOIN asistentes a ON a.id = g.asistente_id
           JOIN rifas r      ON r.id = g.rifa_id
           LEFT JOIN boletos b ON b.id = g.boleto_id
          ORDER BY g.creado_en DESC`);
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.patch('/ganadores/:id', soloStaff, async (req, res, next) => {
    try {
      const entregado = Boolean((req.body || {}).entregado);
      const { rows } = await db.query(
        `UPDATE ganadores
            SET entregado = $2, entregado_en = CASE WHEN $2 THEN now() ELSE NULL END
          WHERE id = $1 RETURNING id, entregado`,
        [req.params.id, entregado]
      );
      if (!rows.length) return res.status(404).json({ error: 'Registro no encontrado' });
      res.json({ ok: true, ganador: rows[0] });
    } catch (err) { next(err); }
  });

  // ==================== Configuración ====================
  router.get('/config', soloAdmin, async (req, res, next) => {
    try {
      const { rows } = await db.query('SELECT * FROM config ORDER BY clave');
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.patch('/config', soloAdmin, async (req, res, next) => {
    try {
      const cambios = req.body || {};
      const permitidas = ['puntos_por_boleto', 'min_modulos_rifa', 'excluir_ganadores',
                          'solo_verificados', 'nombre_evento', 'fecha_evento'];
      for (const [clave, valor] of Object.entries(cambios)) {
        if (!permitidas.includes(clave)) continue;
        await db.query('UPDATE config SET valor = $2 WHERE clave = $1',
                       [clave, String(valor)]);
      }
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ==================== Exportar a CSV ====================
  router.get('/export/:tipo', soloAdmin, async (req, res, next) => {
    try {
      const consultas = {
        asistentes: `SELECT nombre, apellido, telefono, estado, modulos, puntos, boletos
                       FROM v_asistentes ORDER BY puntos DESC`,
        ganadores: `SELECT r.premio, a.nombre, a.apellido, a.telefono, b.folio, g.entregado
                      FROM ganadores g
                      JOIN asistentes a ON a.id = g.asistente_id
                      JOIN rifas r ON r.id = g.rifa_id
                      LEFT JOIN boletos b ON b.id = g.boleto_id
                     ORDER BY g.creado_en`,
        escaneos: `SELECT x.nombre AS modulo, a.nombre, a.apellido, a.telefono, e.creado_en
                     FROM escaneos e
                     JOIN asistentes a ON a.id = e.asistente_id
                     JOIN expositores x ON x.id = e.expositor_id
                    ORDER BY e.creado_en`,
      };
      const sql = consultas[req.params.tipo];
      if (!sql) return res.status(404).json({ error: 'Exportación no disponible' });

      const { rows, fields } = await db.query(sql);
      const cabeceras = fields.map((f) => f.name);
      const escapar = (val) => {
        if (val == null) return '';
        const s = String(val);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        cabeceras.join(','),
        ...rows.map((r) => cabeceras.map((c) => escapar(r[c])).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="ampi_${req.params.tipo}.csv"`);
      res.send('\uFEFF' + csv);   // BOM para que Excel respete los acentos
    } catch (err) { next(err); }
  });

  // ==================== Módulo Quantum: importar, imprimir, entregar ====

  /**
   * Importa la base previa. Sin `confirmar` sólo simula y reporta,
   * para que nadie meta 400 registros por accidente.
   */
  router.post('/importar', soloAdmin, async (req, res, next) => {
    try {
      const { csv, confirmar } = req.body || {};
      if (typeof csv !== 'string' || !csv.trim()) {
        return res.status(400).json({ error: 'Envía el contenido del archivo' });
      }
      if (csv.length > 2 * 1024 * 1024) {
        return res.status(413).json({ error: 'El archivo excede 2 MB' });
      }

      const resultado = await enTransaccion((client) =>
        importacion.importar(client, csv, { simular: !confirmar })
      );
      if (resultado.error) return res.status(400).json(resultado);

      if (confirmar) {
        await db.query(
          `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1, 'importar_csv', $2)`,
          [req.session.usuario.email,
           JSON.stringify({
             nuevos: resultado.nuevos,
             actualizados: resultado.actualizados,
             sin_cambio: resultado.sin_cambio,
             rechazados: resultado.rechazadas.length,
           })]
        ).catch(() => {});   // la bitácora nunca debe tumbar la importación
      }
      res.json({ simulado: !confirmar, ...resultado });
    } catch (err) { next(err); }
  });

  /** Panorama del módulo: impresas, pendientes, entregadas. */
  router.get('/modulo/panorama', soloStaff, async (req, res, next) => {
    try { res.json(await modulo.panorama(db)); }
    catch (err) { next(err); }
  });

  /** Busca al asistente en la mesa de entrega. */
  router.get('/modulo/buscar', soloStaff, async (req, res, next) => {
    try { res.json({ resultados: await modulo.buscar(db, req.query.q || '') }); }
    catch (err) { next(err); }
  });

  /** Marca la entrega del carnet. */
  router.post('/modulo/entregar', soloStaff, async (req, res, next) => {
    try {
      const quien = req.session.usuario ? req.session.usuario.nombre : 'módulo';
      const r = await modulo.entregar(db, parseInt(req.body.id, 10), quien);
      if (!r) return res.status(404).json({ error: 'No encontrado' });
      res.json(r);
    } catch (err) { next(err); }
  });

  /** Deshace una entrega marcada por error. */
  router.post('/modulo/desentregar', soloStaff, async (req, res, next) => {
    try {
      const r = await modulo.desentregar(db, parseInt(req.body.id, 10));
      if (!r) return res.status(404).json({ error: 'No encontrado' });
      res.json(r);
    } catch (err) { next(err); }
  });

  /** Lista de etiquetas por imprimir. */
  router.get('/modulo/etiquetas', soloStaff, async (req, res, next) => {
    try {
      const lista = await modulo.paraImprimir(db, {
        filtro: req.query.filtro === 'todos' ? 'todos' : 'pendientes',
        limite: req.query.limite,
      });
      res.json({ total: lista.length, etiquetas: lista });
    } catch (err) { next(err); }
  });

  /** Datos de un asistente para imprimir su etiqueta individual. */
  router.get('/modulo/asistente/:id', soloStaff, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Id inválido' });
      }
      const { rows } = await db.query(
        `SELECT id, qr_id, nombre, apellido, empresa, codigo_corto
           FROM asistentes WHERE id = $1`, [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
      // Imprimir desde la mesa cuenta como etiqueta impresa.
      await modulo.marcarImpresas(db, [id]).catch(() => {});
      res.json(rows[0]);
    } catch (err) { next(err); }
  });

  /** Marca un lote como impreso, para no repetirlo. */
  router.post('/modulo/etiquetas/impresas', soloStaff, async (req, res, next) => {
    try { res.json(await modulo.marcarImpresas(db, req.body.ids)); }
    catch (err) { next(err); }
  });

  return router;
};
