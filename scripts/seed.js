'use strict';

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { generarCodigoCorto } = require('../src/services/sesion');

const EXPOSITORES = [
  'Inmobiliaria Costa Azul', 'Grupo Constructor Baja', 'Créditos Hipotecarios TJ',
  'Notaría Pública 12', 'Desarrollos Vista Real', 'Century Real Estate',
  'Casas del Pacífico', 'Bancomer Hipotecario', 'Arquitectura Norte',
  'Seguros Patrimonio', 'Terrenos Valle Redondo', 'RE/MAX Tijuana',
  'Infonavit Orientación', 'Constructora Milenio', 'Home Staging BC',
  'Avalúos Profesionales', 'Mudanzas Frontera', 'Decoración Interiores TJ',
  'Coldwell Banker BC', 'Financiera Habitat', 'Grupo Inmobiliario Sur',
  'Desarrollos Altozano', 'Créditos FOVISSSTE', 'Bienes Raíces Premium',
  'Torres del Río', 'Asesoría Fiscal Inmobiliaria', 'Domótica y Smart Home',
  'Paisajismo Residencial', 'Constructora del Valle', 'Inversiones Frontera',
  'Renta Vacacional BC', 'Administración de Condominios', 'Peritos Valuadores',
  'Materiales La Sierra', 'Cocinas Integrales TJ', 'Alarmas y Seguridad',
  'Créditos Santander Casa', 'Terrenos Rosarito', 'Grupo Habitacional Real',
  'Consultoría Urbana BC',
];

const PATROCINADORES = [
  'Banco Nacional Hipotecario',
  'Constructora Baja Norte',
  'Seguros del Pacífico',
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---------- Usuario administrador ----------
    const passAdmin = process.env.ADMIN_PASSWORD || 'ampi2026';
    await client.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol)
            VALUES ($1,$2,$3,'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      ['admin@quantummkt.mx', 'Administrador', await bcrypt.hash(passAdmin, 10)]
    );

    const passStaff = process.env.STAFF_PASSWORD || 'staff2026';
    await client.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol)
            VALUES ($1,$2,$3,'staff')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      ['registro@quantummkt.mx', 'Estación de Registro', await bcrypt.hash(passStaff, 10)]
    );

    // ---------- Patrocinadores ----------
    const patros = [];
    for (let i = 0; i < PATROCINADORES.length; i++) {
      const { rows } = await client.query(
        `INSERT INTO patrocinadores (nombre, orden) VALUES ($1,$2) RETURNING id`,
        [PATROCINADORES[i], i]
      );
      patros.push(rows[0].id);
    }

    // ---------- Expositores ----------
    const credenciales = [];
    for (let i = 0; i < EXPOSITORES.length; i++) {
      const pin = String(crypto.randomInt(1000, 10000));
      const token = crypto.randomBytes(12).toString('hex');
      // El código es lo que el expositor teclea en /scan. Se reintenta
      // ante una colisión, que es improbable pero barata de cubrir.
      let rows = null;
      let codigo = null;
      for (let intento = 0; intento < 8 && !rows; intento++) {
        codigo = generarCodigoCorto();
        try {
          const r = await client.query(
            `INSERT INTO expositores (nombre, pin_hash, token, codigo, puntos, orden)
                  VALUES ($1,$2,$3,$4,1,$5) RETURNING id, nombre, codigo`,
            [EXPOSITORES[i], await bcrypt.hash(pin, 10), token, codigo, i]
          );
          rows = r.rows;
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }
      if (!rows) throw new Error('No se pudo generar un código libre para ' + EXPOSITORES[i]);
      credenciales.push({ id: rows[0].id, nombre: rows[0].nombre, pin, token, codigo: rows[0].codigo });
    }

    // ---------- Rifas del día ----------
    const hoy = new Date();
    const aLasHoras = (h, m) => {
      const d = new Date(hoy);
      d.setHours(h, m, 0, 0);
      return d;
    };
    const rifas = [
      ['Rifa de apertura', 'Tablet Samsung Galaxy Tab A9', 4500, aLasHoras(11, 0), 1, patros[0]],
      ['Rifa de media mañana', 'Cena para dos en Villa Saverios', 2500, aLasHoras(13, 0), 2, patros[1]],
      ['Rifa vespertina', 'Smart TV 55 pulgadas', 9800, aLasHoras(15, 0), 1, patros[2]],
      ['Gran rifa final', 'Fin de semana en Valle de Guadalupe', 18000, aLasHoras(17, 0), 1, patros[0]],
    ];
    for (const [nombre, premio, valor, hora, ganadores, patro] of rifas) {
      await client.query(
        `INSERT INTO rifas (nombre, premio, valor, hora, num_ganadores, patrocinador_id)
              VALUES ($1,$2,$3,$4,$5,$6)`,
        [nombre, premio, valor, hora, ganadores, patro]
      );
    }

    await client.query('COMMIT');

    console.log('\n  Datos iniciales cargados\n');
    console.log(`  Admin:  admin@quantummkt.mx / ${passAdmin}`);
    console.log(`  Staff:  registro@quantummkt.mx / ${passStaff}`);
    console.log(`\n  ${credenciales.length} expositores, ${rifas.length} rifas programadas`);
    console.log('\n  Primeros 5 módulos (el expositor entra en /scan con su código):');
    for (const c of credenciales.slice(0, 5)) {
      console.log(`    ${String(c.id).padStart(2)} ${c.nombre.padEnd(32)} código ${c.codigo}`);
    }
    console.log('\n  Los códigos de los 40 módulos están en credenciales.csv');

    const fs = require('fs');
    const csv = ['id,modulo,codigo,liga_alterna']
      .concat(credenciales.map((c) => `${c.id},"${c.nombre}",${c.codigo},/s/${c.token}`))
      .join('\n');
    fs.writeFileSync(require('path').join(__dirname, '..', 'credenciales.csv'), '\uFEFF' + csv);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
