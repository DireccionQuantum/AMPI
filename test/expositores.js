'use strict';
/**
 * Pruebas del alta, edición, baja y eliminación de expositores (stands)
 * — AMPI 2026. Ojo especial en que borrar nunca destruya historial real.
 */

const { Client } = require('pg');

const URL = process.env.DATABASE_URL || 'postgres://postgres:test@localhost:5432/ampi_test';
const BASE = process.env.BASE || 'http://localhost:3000';

let pasaron = 0, fallaron = 0;
function ok(c, m, x) {
  if (c) { pasaron++; console.log('  ok    ' + m); }
  else { fallaron++; console.log('  FALLA ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); }
}
function seccion(t) { console.log('\n=== ' + t + ' ==='); }

let cookie = '';
async function api(ruta, opts = {}) {
  const r = await fetch(BASE + ruta, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}

(async () => {
  const db = new Client({ connectionString: URL });
  await db.connect();
  await db.query("DELETE FROM expositores WHERE nombre LIKE 'PRUEBA %'");

  try {
    seccion('1. Sin sesión no se pasa');
    let r = await api('/api/admin/expositores', { method: 'POST', body: JSON.stringify({ nombre: 'PRUEBA X' }) });
    ok(r.status === 403, 'crear exige sesión', r.status);

    seccion('2. Entra el administrador');
    r = await api('/api/admin/login', {
      method: 'POST', body: JSON.stringify({ email: 'admin@quantummkt.mx', password: 'ampi2026' }),
    });
    ok(r.status === 200, 'sesión de admin', r.body);

    seccion('3. Alta desde cero');
    r = await api('/api/admin/expositores', {
      method: 'POST',
      body: JSON.stringify({ nombre: 'PRUEBA Stand Nuevo', empresa: 'Empresa de prueba', puntos: 2 }),
    });
    ok(r.status === 200 && /^\d{4}$/.test(r.body.pin), 'crea el stand y entrega PIN de 4 dígitos', r.body);
    const nuevo = r.body.expositor;

    r = await api('/api/admin/expositores', { method: 'POST', body: JSON.stringify({ nombre: 'X' }) });
    ok(r.status === 422, 'rechaza nombre de una sola letra');

    r = await api('/api/admin/expositores', { method: 'POST', body: JSON.stringify({}) });
    ok(r.status === 422, 'rechaza alta sin nombre');

    seccion('4. Aparece en el listado con sus datos');
    r = await api('/api/admin/expositores');
    const enLista = r.body.find((x) => x.id === nuevo.id);
    ok(!!enLista, 'el nuevo stand aparece en el listado');
    ok(enLista.puntos === 2, 'respeta los puntos indicados al crear', enLista);
    ok(enLista.activo === true, 'nace activo');
    ok(Number(enLista.visitas) === 0, 'nace sin visitas');

    seccion('5. Editar');
    r = await api('/api/admin/expositores/' + nuevo.id, {
      method: 'PATCH', body: JSON.stringify({ nombre: 'PRUEBA Stand Editado', puntos: 5 }),
    });
    ok(r.status === 200 && r.body.expositor.nombre === 'PRUEBA Stand Editado', 'edita el nombre', r.body);
    ok(r.body.expositor.puntos === 5, 'edita los puntos', r.body);

    r = await api('/api/admin/expositores/' + nuevo.id, {
      method: 'PATCH', body: JSON.stringify({ empresa: 'Empresa Actualizada' }),
    });
    r = await api('/api/admin/expositores');
    const editado = r.body.find((x) => x.id === nuevo.id);
    ok(editado.empresa === 'Empresa Actualizada', 'un campo se puede editar sin tocar los demás');
    ok(editado.nombre === 'PRUEBA Stand Editado', 'el nombre editado antes se conserva');

    seccion('6. Desactivar y reactivar (vía /activo)');
    r = await api('/api/admin/expositores/' + nuevo.id + '/activo', {
      method: 'POST', body: JSON.stringify({ activo: false }),
    });
    ok(r.status === 200 && r.body.expositor.activo === false, 'desactiva', r.body);

    r = await api('/api/admin/expositores/' + nuevo.id + '/activo', {
      method: 'POST', body: JSON.stringify({ activo: true }),
    });
    ok(r.body.expositor.activo === true, 'reactiva');

    seccion('7. Eliminar un stand SIN historial — sí se borra');
    r = await api('/api/admin/expositores', {
      method: 'POST', body: JSON.stringify({ nombre: 'PRUEBA Stand Vacío' }),
    });
    const vacio = r.body.expositor;

    r = await api('/api/admin/expositores/' + vacio.id, { method: 'DELETE' });
    ok(r.status === 200, 'elimina el stand sin escaneos', r.body);

    r = await api('/api/admin/expositores');
    ok(!r.body.some((x) => x.id === vacio.id), 'ya no aparece en el listado');

    const enBase = await db.query('SELECT id FROM expositores WHERE id = $1', [vacio.id]);
    ok(enBase.rows.length === 0, 'de verdad ya no existe en la tabla');

    seccion('8. Eliminar un stand CON historial — se protege');
    // Simulamos que ya tuvo actividad real en el evento.
    const asis = await db.query(
      `INSERT INTO asistentes (qr_id, codigo_corto, nombre, estado, origen, datos_en)
       VALUES ($1,'PRB999','Visitante Prueba','verificado','stand', now())
       RETURNING id`,
      [require('crypto').randomBytes(12).toString('hex')]
    );
    await db.query(
      'INSERT INTO escaneos (asistente_id, expositor_id, puntos) VALUES ($1,$2,1)',
      [asis.rows[0].id, nuevo.id]
    );

    r = await api('/api/admin/expositores/' + nuevo.id, { method: 'DELETE' });
    ok(r.status === 409, 'rechaza borrar un stand con escaneos', r.body);
    ok(r.body.visitas === 1, 'informa cuántas visitas tiene', r.body);
    ok(/Desactívalo/.test(r.body.error), 'sugiere desactivar en vez de borrar');

    const sigueVivo = await db.query('SELECT id FROM expositores WHERE id = $1', [nuevo.id]);
    ok(sigueVivo.rows.length === 1, 'el stand con historial sigue existiendo');

    const sigueElEscaneo = await db.query(
      'SELECT id FROM escaneos WHERE expositor_id = $1', [nuevo.id]
    );
    ok(sigueElEscaneo.rows.length === 1, 'y su escaneo tampoco se perdió');

    // Aunque esté desactivado, con historial sigue protegido.
    await api('/api/admin/expositores/' + nuevo.id + '/activo', {
      method: 'POST', body: JSON.stringify({ activo: false }),
    });
    r = await api('/api/admin/expositores/' + nuevo.id, { method: 'DELETE' });
    ok(r.status === 409, 'sigue protegido aunque esté desactivado');

    seccion('9. Casos raros');
    r = await api('/api/admin/expositores/999999', { method: 'DELETE' });
    ok(r.status === 404, 'eliminar un id inexistente da 404');

    r = await api('/api/admin/expositores/abc', { method: 'DELETE' });
    ok(r.status === 400, 'un id no numérico da 400, no explota');

    r = await api('/api/admin/expositores/999999/activo', {
      method: 'POST', body: JSON.stringify({ activo: false }),
    });
    ok(r.status === 404, 'desactivar un id inexistente da 404');

  } finally {
    await db.query("DELETE FROM escaneos WHERE expositor_id IN (SELECT id FROM expositores WHERE nombre LIKE 'PRUEBA %')");
    await db.query("DELETE FROM asistentes WHERE nombre = 'Visitante Prueba'");
    await db.query("DELETE FROM expositores WHERE nombre LIKE 'PRUEBA %'");
    await db.end();
  }

  console.log('\n' + '='.repeat(52));
  console.log(`  ${pasaron} pruebas pasaron, ${fallaron} fallaron`);
  console.log('='.repeat(52) + '\n');
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
