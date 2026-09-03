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
const usuarios = require('../services/usuarios');
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
      // Código de acceso: es lo que teclea en la dirección general.
      const { generarCodigoCorto } = require('../services/sesion');

      let rows;
      let creado = false;
      for (let intento = 0; intento < 8 && !creado; intento++) {
        try {
          const r = await db.query(
            `INSERT INTO expositores (nombre, empresa, contacto, telefono, pin_hash, token, codigo, puntos, orden)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, nombre, token, codigo`,
            [String(nombre).trim(), empresa || null, contacto || null, telefono || null,
             await hashearPassword(pin), token, generarCodigoCorto(),
             Math.max(1, Number(puntos) || 1), Number(orden) || 0]
          );
          rows = r.rows;
          creado = true;
        } catch (e) {
          if (e.code !== '23505') throw e;   // colisión de código: reintenta
        }
      }
      if (!creado) return res.status(500).json({ error: 'No se pudo generar un código libre' });

      // El PIN se muestra UNA vez: después sólo vive hasheado.
      res.json({ ok: true, expositor: rows[0], pin, codigo: rows[0].codigo });
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

  /**
   * Da de baja o de alta un módulo. Desactivar no borra nada: el histórico
   * de escaneos y puntos queda intacto, pero su PIN y liga dejan de aceptar
   * escaneos nuevos. Sirve para un expositor que canceló o llegó tarde.
   */
  router.post('/expositores/:id/activo', soloAdmin, async (req, res, next) => {
    try {
      const activo = !!(req.body || {}).activo;
      const { rows } = await db.query(
        `UPDATE expositores SET activo = $2 WHERE id = $1
         RETURNING id, nombre, activo`,
        [req.params.id, activo]
      );
      if (!rows.length) return res.status(404).json({ error: 'Módulo no encontrado' });
      await db.query(
        `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1,'expositor_activo',$2)`,
        [req.session.usuario.email, JSON.stringify(rows[0])]
      ).catch(() => {});
      res.json({ ok: true, expositor: rows[0] });
    } catch (err) { next(err); }
  });

  /**
   * Elimina un módulo, con una regla que no se puede saltar desde la
   * interfaz: si ya tiene escaneos registrados, NO se borra de verdad.
   *
   * ¿Por qué? La tabla de escaneos tiene ON DELETE CASCADE hacia
   * expositores. Borrar un módulo con historial borraría en cascada los
   * puntos que asistentes reales ya ganaron ahí, y eso descuadra su total
   * sin que quede ningún rastro de qué pasó. Un stand que nunca fue
   * escaneado (dado de alta por error, o que canceló antes del evento) sí
   * se puede quitar por completo sin ese riesgo.
   */
  router.delete('/expositores/:id', soloAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });

      const visitas = await db.query(
        'SELECT count(*)::int n FROM escaneos WHERE expositor_id = $1', [id]
      );
      if (visitas.rows[0].n > 0) {
        return res.status(409).json({
          error: 'Este módulo ya tiene escaneos registrados y no se puede eliminar. ' +
                 'Desactívalo en su lugar para conservar el historial.',
          visitas: visitas.rows[0].n,
        });
      }

      const { rows } = await db.query(
        'DELETE FROM expositores WHERE id = $1 RETURNING id, nombre', [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Módulo no encontrado' });

      await db.query(
        `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1,'eliminar_expositor',$2)`,
        [req.session.usuario.email, JSON.stringify(rows[0])]
      ).catch(() => {});
      res.json({ ok: true, expositor: rows[0] });
    } catch (err) { next(err); }
  });

  /** Regenera el código de acceso del módulo. Útil si se filtró. */
  router.post('/expositores/:id/codigo', soloAdmin, async (req, res, next) => {
    try {
      const { generarCodigoCorto } = require('../services/sesion');
      for (let intento = 0; intento < 8; intento++) {
        const codigo = generarCodigoCorto();
        try {
          const { rows } = await db.query(
            `UPDATE expositores SET codigo = $2 WHERE id = $1
             RETURNING id, nombre, codigo`,
            [req.params.id, codigo]
          );
          if (!rows.length) return res.status(404).json({ error: 'Módulo no encontrado' });
          return res.json({ ok: true, expositor: rows[0], codigo });
        } catch (e) {
          if (e.code !== '23505') throw e;   // colisión: reintentamos
        }
      }
      res.status(500).json({ error: 'No se pudo generar un código libre' });
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
  /**
   * Elimina los "fantasmas": registros pendientes sin nombre ni teléfono.
   *
   * Se generan cuando el escáner lee un código de 24 hex que no pertenece a
   * nadie. El sistema los crea a propósito (así el punto no se pierde si
   * alguien llega con un QR que no conocemos), pero si vienen de un error
   * sólo estorban en las listas.
   *
   * Sólo borra los que NO tienen nombre ni teléfono: alguien identificado
   * nunca se toca, aunque siga pendiente de verificar.
   */
  router.post('/asistentes/limpiar-fantasmas', soloAdmin, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `WITH borrados AS (
           DELETE FROM asistentes
            WHERE nombre IS NULL AND telefono IS NULL AND estado = 'pendiente'
            RETURNING id
         ) SELECT count(*)::int n FROM borrados`
      );
      const n = rows[0].n;
      if (n) {
        await db.query(
          `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1,'limpiar_fantasmas',$2)`,
          [req.session.usuario.email, JSON.stringify({ eliminados: n })]
        ).catch(() => {});
      }
      res.json({ ok: true, eliminados: n });
    } catch (err) { next(err); }
  });

  /** Cuántos fantasmas hay ahora mismo, para avisar en el panel. */
  router.get('/asistentes/fantasmas', soloStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM asistentes
          WHERE nombre IS NULL AND telefono IS NULL AND estado = 'pendiente'`
      );
      res.json({ fantasmas: rows[0].n });
    } catch (err) { next(err); }
  });

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
                x.nombre AS modulo,
                (SELECT COUNT(*) FROM ganadores g WHERE g.rifa_id = r.id) AS ganadores
           FROM rifas r
           LEFT JOIN patrocinadores p ON p.id = r.patrocinador_id
           LEFT JOIN expositores   x ON x.id = r.expositor_id
          ORDER BY r.hora`);
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.post('/rifas', soloAdmin, async (req, res, next) => {
    try {
      const { nombre, premio, valor, hora, num_ganadores,
              min_modulos, patrocinador_id, expositor_id, auto } = req.body || {};

      if (!premio || String(premio).trim().length < 2) {
        return res.status(422).json({ error: 'Describe el premio' });
      }
      const cuando = new Date(hora);
      if (isNaN(cuando)) return res.status(422).json({ error: 'La hora no es válida' });

      const { rows } = await db.query(
        `INSERT INTO rifas (nombre, premio, valor, hora, num_ganadores,
                            min_modulos, patrocinador_id, expositor_id, auto)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [String(nombre || premio).trim(), String(premio).trim(),
         valor != null && valor !== '' ? Number(valor) : null,
         cuando, Math.max(1, Number(num_ganadores) || 1),
         Math.max(0, Number(min_modulos) || 0),
         patrocinador_id || null,
         // Módulo del patrocinador: sólo participa quien visitó su stand.
         expositor_id ? parseInt(expositor_id, 10) || null : null,
         auto !== false]
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

  /**
   * Los contactos de un módulo, para entregárselos al expositor.
   *
   * Es el entregable que más le importa a quien patrocinó un stand: la
   * lista de personas que se acercaron y escanearon su código. Se genera
   * uno por módulo, no la lista completa, porque cada expositor sólo
   * tiene derecho a los contactos que él mismo levantó.
   */
  router.get('/exportar/modulo/:id.csv', soloAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Id inválido' });
      }

      const ex = await db.query(
        'SELECT nombre, empresa FROM expositores WHERE id = $1', [id]
      );
      if (!ex.rows[0]) return res.status(404).json({ error: 'Módulo no encontrado' });

      const { rows } = await db.query(
        `SELECT a.nombre, a.apellido, a.empresa, a.telefono, a.email,
                a.fila, a.asiento,
                to_char(e.creado_en AT TIME ZONE 'America/Tijuana',
                        'DD/MM/YYYY HH24:MI') AS visita
           FROM escaneos e
           JOIN asistentes a ON a.id = e.asistente_id
          WHERE e.expositor_id = $1
          ORDER BY e.creado_en`,
        [id]
      );

      const col = [
        ['nombre', 'Nombre'], ['apellido', 'Apellidos'], ['empresa', 'Empresa'],
        ['telefono', 'Teléfono'], ['email', 'Correo'],
        ['fila', 'Fila'], ['asiento', 'Asiento'], ['visita', 'Visitó el stand'],
      ];
      const esc = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        col.map((c) => c[1]).join(','),
        ...rows.map((r) => col.map((c) => esc(r[c[0]])).join(',')),
      ].join('\n');

      // El nombre del archivo lleva el del módulo: cuando el organizador
      // descarga veinte, tiene que saber cuál es cuál sin abrirlos.
      const limpio = (ex.rows[0].nombre || 'modulo')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="contactos-${limpio}.csv"`);
      res.send('\uFEFF' + csv);
    } catch (err) { next(err); }
  });

  /** Cuántos contactos levantó cada módulo, para la pantalla de entrega. */
  router.get('/exportar/modulos', soloStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT x.id, x.nombre, x.empresa, x.activo,
                count(e.id)::int AS contactos,
                count(a.telefono)::int AS con_telefono,
                count(a.email)::int AS con_correo
           FROM expositores x
           LEFT JOIN escaneos e ON e.expositor_id = x.id
           LEFT JOIN asistentes a ON a.id = e.asistente_id
          GROUP BY x.id, x.nombre, x.empresa, x.activo
          ORDER BY count(e.id) DESC, x.nombre`
      );
      res.json({ modulos: rows });
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
  /**
   * Completa los datos de un asistente desde la mesa de entrega.
   *
   * Para las cortesías de patrocinador: llegan con etiqueta que sólo
   * dice la empresa, y aquí se les captura nombre y teléfono para que
   * entren bien a las rifas. Todos los campos son opcionales: si la
   * persona trae prisa se guarda lo que haya y se completa después.
   */
  router.post('/modulo/asistente/:id/datos', soloStaff, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Id inválido' });
      }
      const b = req.body || {};
      const campos = [];
      const vals = [id];
      const errores = {};

      const texto = (v, max) => {
        const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
        return s ? s.slice(0, max) : null;
      };

      const nombre = texto(b.nombre, 60);
      if (nombre !== null) {
        if (nombre.length < 2) errores.nombre = 'Muy corto';
        else { campos.push(`nombre = $${vals.length + 1}`); vals.push(nombre); }
      }

      const apellido = texto(b.apellido, 60);
      if (apellido !== null) { campos.push(`apellido = $${vals.length + 1}`); vals.push(apellido); }

      const empresa = texto(b.empresa, 80);
      if (empresa !== null) { campos.push(`empresa = $${vals.length + 1}`); vals.push(empresa); }

      // El teléfono se guarda a 10 dígitos, como el resto del sistema.
      if (b.telefono != null && String(b.telefono).trim()) {
        const d = String(b.telefono).replace(/\D/g, '');
        const diez = d.length > 10 ? d.slice(-10) : d;
        if (diez.length !== 10) errores.telefono = 'Deben ser 10 dígitos';
        else { campos.push(`telefono = $${vals.length + 1}`); vals.push(diez); }
      }

      if (b.email != null && String(b.email).trim()) {
        const e = String(b.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) || e.length > 120) {
          errores.email = 'Ese correo no parece válido';
        } else { campos.push(`email = $${vals.length + 1}`); vals.push(e); }
      }

      if (Object.keys(errores).length) return res.status(422).json({ errores });
      if (!campos.length) return res.status(422).json({ error: 'No hay nada que guardar' });

      // Estar identificado por el personal cuenta como verificación: así
      // la persona entra a las rifas, que es el objetivo de capturarlo.
      campos.push(`estado = 'verificado'`);

      const { rows } = await db.query(
        `UPDATE asistentes SET ${campos.join(', ')} WHERE id = $1
         RETURNING id, nombre, apellido, empresa, telefono, email, fila, asiento`,
        vals
      );
      if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
      res.json({ ok: true, asistente: rows[0] });
    } catch (err) { next(err); }
  });

  /**
   * Guarda el correo de un asistente desde la mesa de entrega.
   *
   * Se separa de "entregar" a propósito: en el evento no siempre hay
   * tiempo de pedir el correo, y obligarlo detendría la fila. Aquí se
   * puede capturar antes, después, o nunca.
   */
  router.post('/modulo/asistente/:id/email', soloStaff, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Id inválido' });
      }
      const crudo = String((req.body || {}).email || '').trim().toLowerCase();

      // Vacío borra el correo: sirve para corregir una captura errónea.
      let email = null;
      if (crudo) {
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(crudo) || crudo.length > 120) {
          return res.status(422).json({ error: 'Ese correo no parece válido' });
        }
        email = crudo;
      }

      const { rows } = await db.query(
        `UPDATE asistentes SET email = $2 WHERE id = $1
         RETURNING id, nombre, apellido, email`,
        [id, email]
      );
      if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
      res.json({ ok: true, asistente: rows[0] });
    } catch (err) { next(err); }
  });

  /**
   * Asigna el siguiente asiento libre de una fila.
   *
   * Para el día 2: llega alguien sin lugar, se le da el próximo
   * disponible sin que el personal tenga que recordar cuál sigue.
   *
   * Va dentro de una transacción con la fila bloqueada: si dos mesas
   * asignan al mismo tiempo, la segunda espera y toma el siguiente, en
   * vez de repetir el asiento.
   */
  router.post('/modulo/asignar-asiento', soloStaff, async (req, res, next) => {
    try {
      const id = parseInt((req.body || {}).id, 10);
      const fila = String((req.body || {}).fila || '').trim().toUpperCase();
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Id inválido' });
      }
      if (!/^[A-Z]{1,4}$/.test(fila)) {
        return res.status(400).json({ error: 'Fila inválida' });
      }

      // El asiento puede venir escrito a mano. Si no viene, se toma el
      // primer hueco libre de esa fila.
      const pedido = (req.body || {}).asiento;
      let manual = null;
      if (pedido != null && String(pedido).trim() !== '') {
        manual = parseInt(String(pedido).trim(), 10);
        if (!Number.isInteger(manual) || manual < 1 || manual > 199) {
          return res.status(422).json({ error: 'El asiento debe ser un número del 1 al 199' });
        }
      }

      const r = await enTransaccion(async (client) => {
        // Se bloquean los asientos ya usados de esa fila para que dos
        // asignaciones simultáneas no elijan el mismo número.
        const ocup = await client.query(
          `SELECT id, asiento, nombre, apellido FROM asistentes
            WHERE upper(fila) = $1 AND asiento IS NOT NULL
            ORDER BY asiento FOR UPDATE`,
          [fila]
        );
        const usados = new Map(ocup.rows.map((x) => [x.asiento, x]));

        let elegido;
        if (manual != null) {
          // Si ya está ocupado se avisa con el nombre de quien lo tiene:
          // el personal necesita saber a quién le está quitando el lugar,
          // no sólo que "está ocupado".
          const quien = usados.get(manual);
          if (quien && quien.id !== id) {
            const nom = [quien.nombre, quien.apellido].filter(Boolean).join(' ');
            return { error: `${fila}-${manual} ya es de ${nom || 'otra persona'}` };
          }
          elegido = manual;
        } else {
          elegido = 1;
          while (usados.has(elegido) && elegido < 200) elegido++;
          if (elegido >= 200) return { error: 'No hay asientos libres en esa fila' };
        }

        const upd = await client.query(
          `UPDATE asistentes SET fila = $2, asiento = $3
            WHERE id = $1 RETURNING id, nombre, apellido, empresa, fila, asiento`,
          [id, fila, elegido]
        );
        if (!upd.rows[0]) return { error: 'Asistente no encontrado' };
        return { ok: true, asistente: upd.rows[0] };
      });

      if (r.error) return res.status(r.error.includes('encontrado') ? 404 : 409).json(r);
      res.json(r);
    } catch (err) { next(err); }
  });

  /** Filas del salón con su avance de impresión, para el selector. */
  router.get('/modulo/filas', soloStaff, async (req, res, next) => {
    try {
      res.json({ filas: await modulo.filasDelSalon(db) });
    } catch (err) { next(err); }
  });

  router.get('/modulo/etiquetas', soloStaff, async (req, res, next) => {
    try {
      const lista = await modulo.paraImprimir(db, {
        filtro: req.query.filtro === 'todos' ? 'todos' : 'pendientes',
        limite: req.query.limite,
        orden: req.query.orden,          // el servicio valida contra su lista
        fila: req.query.fila || null,    // idem: valida el formato
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
        `SELECT id, qr_id, nombre, apellido, empresa, codigo_corto, fila, asiento, sin_qr
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

  // ==================== Usuarios del panel ==============================

  router.get('/usuarios', soloAdmin, async (req, res, next) => {
    try {
      res.json({
        usuarios: await usuarios.listar(db),
        yo: req.session.usuario.id,
        sugerida: usuarios.passwordSugerida(),
      });
    } catch (err) { next(err); }
  });

  router.post('/usuarios', soloAdmin, async (req, res, next) => {
    try {
      const r = await usuarios.crear(db, req.body || {});
      if (r.error) return res.status(400).json(r);
      await db.query(
        `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1,'crear_usuario',$2)`,
        [req.session.usuario.email, JSON.stringify({ email: r.usuario.email, rol: r.usuario.rol })]
      ).catch(() => {});
      res.status(201).json(r);
    } catch (err) { next(err); }
  });

  router.post('/usuarios/:id/password', soloAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
      const r = await usuarios.cambiarPassword(db, id, (req.body || {}).password);
      if (r.error) return res.status(400).json(r);
      await db.query(
        `INSERT INTO bitacora (actor, accion, detalle) VALUES ($1,'cambiar_password',$2)`,
        [req.session.usuario.email, JSON.stringify({ usuario: r.usuario.email })]
      ).catch(() => {});
      res.json(r);
    } catch (err) { next(err); }
  });

  router.post('/usuarios/:id/activo', soloAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
      const r = await usuarios.cambiarActivo(
        db, id, !!(req.body || {}).activo, req.session.usuario.id
      );
      if (r.error) return res.status(400).json(r);
      res.json(r);
    } catch (err) { next(err); }
  });

  router.post('/usuarios/:id/rol', soloAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
      const r = await usuarios.cambiarRol(
        db, id, (req.body || {}).rol, req.session.usuario.id
      );
      if (r.error) return res.status(400).json(r);
      res.json(r);
    } catch (err) { next(err); }
  });

  return router;
};
