'use strict';
/**
 * Pruebas de importación de base previa — AMPI 2026
 * Corre contra PostgreSQL real, en una base desechable.
 */

const { Client } = require('pg');
const imp = require('../src/services/importacion');

const URL = process.env.DATABASE_URL || 'postgres://postgres:test@localhost:5432/ampi_test';

let pasaron = 0, fallaron = 0;
function ok(cond, msg, extra) {
  if (cond) { pasaron++; console.log('  ok    ' + msg); }
  else { fallaron++; console.log('  FALLA ' + msg + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
function seccion(t) { console.log('\n=== ' + t + ' ==='); }

(async () => {
  const db = new Client({ connectionString: URL });
  await db.connect();
  await db.query('BEGIN');

  try {
    // ---------------------------------------------------------------
    seccion('1. Lectura del archivo');

    const csvBasico =
      'Nombre,Apellido,Telefono,Email,Empresa\n' +
      'María,Hernández,664-123-4567,maria@test.mx,Inmobiliaria Sur\n' +
      'José Luis,de la Torre,6641234568,jose@test.mx,Grupo Costa\n';

    let r = imp.leerCsv(csvBasico);
    ok(!r.error && r.filas.length === 2, 'lee un CSV con encabezados normales', r.error);
    ok(r.filas[1].apellido === 'de la Torre', 'conserva apellidos con partículas');

    // Encabezados como los manda el cliente en la vida real
    const csvRaro =
      'ID;NOMBRE COMPLETO;Celular;Correo Electrónico;Organización\n' +
      '69a6430d0cd0da0015a69dd2;Ana Ruvalcaba;+52 664 987 6543;ANA@TEST.MX;Hoteles Baja\n';
    r = imp.leerCsv(csvRaro);
    ok(!r.error && r.filas.length === 1, 'acepta punto y coma como separador', r.error);
    ok(r.filas[0].qr_id === '69a6430d0cd0da0015a69dd2', 'reconoce la columna ID con acentos y mayúsculas');

    // Comas dentro de comillas
    r = imp.leerCsv('Nombre,Empresa\n"Pérez, Juan","Grupo A, S.A. de C.V."\n');
    ok(r.filas[0].empresa === 'Grupo A, S.A. de C.V.', 'respeta comas dentro de comillas');

    ok(imp.leerCsv('').error === 'archivo_vacio', 'rechaza archivo vacío');
    ok(imp.leerCsv('Nombre\n').error === 'sin_datos', 'rechaza archivo sin filas');
    ok(imp.leerCsv('Cosa,Otra\n1,2\n').error === 'sin_columnas_reconocibles',
       'rechaza archivo sin columnas útiles');

    // ---------------------------------------------------------------
    seccion('2. Validación de filas');

    let f = imp.prepararFila({ linea: 2, nombre: 'Ana María Ruvalcaba', apellido: '' });
    ok(f.ok && f.nombre === 'Ana' && f.apellido === 'María Ruvalcaba',
       'parte el nombre cuando viene en una sola columna');

    f = imp.prepararFila({ linea: 3, nombre: 'Luis', telefono: '+52 (664) 123-4567' });
    ok(f.telefono === '6641234567', 'normaliza teléfono con lada y símbolos');

    f = imp.prepararFila({ linea: 4, nombre: 'Luis', telefono: '123' });
    ok(f.ok && f.telefono === null, 'teléfono inválido no tumba la fila, sólo se descarta');

    f = imp.prepararFila({ linea: 5, nombre: '', apellido: 'Solo Apellido' });
    ok(!f.ok && f.motivo === 'nombre_invalido', 'rechaza fila sin nombre');

    f = imp.prepararFila({ linea: 6, nombre: 'Ana', qr_id: 'no-es-un-objectid' });
    ok(!f.ok && f.motivo === 'qr_invalido', 'rechaza qr con formato inválido');

    f = imp.prepararFila({ linea: 7, nombre: 'Ana', qr_id: '69A6430D0CD0DA0015A69DD2' });
    ok(f.ok && f.qr_id === '69a6430d0cd0da0015a69dd2', 'normaliza el qr a minúsculas');

    // ---------------------------------------------------------------
    seccion('3. Importación real');

    const csv =
      'ID,Nombre,Apellido,Telefono,Empresa\n' +
      '69a6430d0cd0da0015a69dd2,María,Hernández,6641110001,Inmobiliaria Sur\n' +
      ',José Luis,de la Torre,6641110002,Grupo Costa\n' +
      ',Ana,Ruvalcaba,6641110003,Hoteles Baja\n';

    let res = await imp.importar(db, csv);
    ok(res.nuevos === 3, 'da de alta las 3 filas', res);
    ok(res.creados.every((c) => /^[a-f0-9]{24}$/.test(c.qr_id)),
       'todos quedan con qr_id de 24 hex');
    ok(res.creados.every((c) => /^[A-Z0-9]{6}$/.test(c.codigo_corto)),
       'todos reciben código corto de respaldo');

    const conservado = res.creados.find((c) => c.nombre === 'María');
    ok(conservado.qr_id === '69a6430d0cd0da0015a69dd2',
       'respeta el ObjectId de WeChamber cuando viene en el archivo');

    const propio = res.creados.find((c) => c.nombre === 'Ana');
    ok(propio.qr_id !== '69a6430d0cd0da0015a69dd2' && propio.qr_id.length === 24,
       'emite qr propio cuando el archivo no lo trae');

    let q = await db.query("SELECT estado, origen FROM asistentes WHERE telefono = '6641110003'");
    ok(q.rows[0].estado === 'verificado' && q.rows[0].origen === 'csv',
       'los importados quedan verificados y marcados con origen csv');

    // ---------------------------------------------------------------
    seccion('4. Reimportar no duplica');

    res = await imp.importar(db, csv);
    ok(res.nuevos === 0, 'segunda pasada no crea a nadie nuevo', res);
    ok(res.sin_cambio === 3, 'reconoce a los 3 como ya existentes', res);

    q = await db.query("SELECT count(*)::int n FROM asistentes WHERE telefono LIKE '664111000%'");
    ok(q.rows[0].n === 3, 'siguen siendo 3 registros en la base');

    // ---------------------------------------------------------------
    seccion('5. Rellenar huecos sin pisar datos');

    await db.query("UPDATE asistentes SET empresa = NULL, email = NULL WHERE telefono = '6641110002'");
    const csvRelleno =
      'Nombre,Telefono,Email,Empresa\n' +
      'José Luis,6641110002,jose@nuevo.mx,Grupo Costa Actualizado\n';
    res = await imp.importar(db, csvRelleno);
    ok(res.actualizados === 1, 'actualiza al que tenía huecos', res);

    q = await db.query("SELECT nombre, email, empresa FROM asistentes WHERE telefono = '6641110002'");
    ok(q.rows[0].email === 'jose@nuevo.mx', 'llena el correo que estaba vacío');
    ok(q.rows[0].nombre === 'José Luis', 'NO pisa el nombre que ya estaba capturado');

    // ---------------------------------------------------------------
    seccion('6. Duplicados dentro del mismo archivo');

    const csvDup =
      'Nombre,Telefono\n' +
      'Carlos,6642220001\n' +
      'Carlos,6642220001\n' +
      'Carlos Segundo,6642220002\n';
    res = await imp.importar(db, csvDup);
    ok(res.nuevos === 2, 'ignora la fila repetida del archivo', res);
    ok(res.rechazadas.some((x) => x.motivo === 'duplicado_en_archivo'),
       'reporta el duplicado en lugar de callarlo');

    // ---------------------------------------------------------------
    seccion('7. Archivo sucio no aborta la importación');

    const csvSucio =
      'Nombre,Telefono,ID\n' +
      'Bueno Uno,6643330001,\n' +
      ',6643330002,\n' +
      'Malo Qr,6643330003,xxxx\n' +
      'Bueno Dos,6643330004,\n';
    res = await imp.importar(db, csvSucio);
    ok(res.nuevos === 2, 'inserta las 2 filas buenas', res);
    ok(res.rechazadas.length === 2, 'reporta las 2 filas malas', res.rechazadas);
    ok(res.rechazadas.some((x) => x.motivo === 'nombre_invalido')
       && res.rechazadas.some((x) => x.motivo === 'qr_invalido'),
       'distingue el motivo de cada rechazo');

    // ---------------------------------------------------------------
    seccion('8. Modo simulación');

    const antes = (await db.query('SELECT count(*)::int n FROM asistentes')).rows[0].n;
    res = await imp.importar(db, 'Nombre,Telefono\nFantasma,6649990001\n', { simular: true });
    const despues = (await db.query('SELECT count(*)::int n FROM asistentes')).rows[0].n;
    ok(res.validas === 1 && antes === despues, 'la simulación no escribe nada en la base');

  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }

  console.log('\n' + '='.repeat(52));
  console.log(`  ${pasaron} pruebas pasaron, ${fallaron} fallaron`);
  console.log('='.repeat(52) + '\n');
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
