'use strict';
/**
 * Pruebas del flujo del módulo Quantum — AMPI 2026
 * Importar base previa → imprimir etiquetas → entregar en el evento.
 *
 * Corre contra el servidor real por HTTP, con sesión de admin de verdad.
 */

const { Client } = require('pg');
const mod = require('../src/services/modulo');
const imp = require('../src/services/importacion');

const URL = process.env.DATABASE_URL || 'postgres://postgres:test@localhost:5432/ampi_test';
const BASE = process.env.BASE || 'http://localhost:8790';

let pasaron = 0, fallaron = 0;
function ok(cond, msg, extra) {
  if (cond) { pasaron++; console.log('  ok    ' + msg); }
  else { fallaron++; console.log('  FALLA ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function seccion(t) { console.log('\n=== ' + t + ' ==='); }

let cookie = '';
async function api(ruta, opts = {}) {
  const r = await fetch(BASE + ruta, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (e) { /* respuestas sin json */ }
  return { status: r.status, body: cuerpo };
}

(async () => {
  const db = new Client({ connectionString: URL });
  await db.connect();

  const LIMPIAR = `DELETE FROM asistentes
     WHERE telefono LIKE '665%'
        OR nombre IN ('SinTelefono','Nueva','Nuevo')`;

  // Base limpia para no chocar con datos de otras pruebas.
  await db.query(LIMPIAR);

  try {
    // ---------------------------------------------------------------
    seccion('1. Seguridad antes que nada');

    let r = await api('/api/admin/modulo/buscar?q=perez');
    ok(r.status === 403, 'buscar exige sesión', r.status);

    r = await api('/api/admin/importar', {
      method: 'POST', body: JSON.stringify({ csv: 'Nombre\nHacker\n', confirmar: true }),
    });
    ok(r.status === 403, 'importar exige sesión', r.status);

    r = await api('/api/admin/modulo/etiquetas');
    ok(r.status === 403, 'listar etiquetas exige sesión', r.status);

    // ---------------------------------------------------------------
    seccion('2. Sesión de administrador');

    r = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@quantummkt.mx', password: 'ampi2026' }),
    });
    ok(r.status === 200, 'entra el administrador', r.body);

    // ---------------------------------------------------------------
    seccion('3. Importar la base previa');

    const csv =
      'ID,Nombre,Apellido,Telefono,Empresa\n' +
      ',Ricardo,Solís Beltrán,6650000001,Inmobiliaria Costa\n' +
      ',Karla,de la Torre,6650000002,Grupo Baja\n' +
      ',Mauricio,Ríos,6650000003,Hoteles del Valle\n' +
      ',SinTelefono,Apellido,,Empresa X\n' +
      ',,6650000009,,\n';

    r = await api('/api/admin/importar', {
      method: 'POST', body: JSON.stringify({ csv }),
    });
    ok(r.status === 200 && r.body.simulado === true, 'sin confirmar sólo simula', r.body);
    const antes = (await db.query(
      `SELECT count(*)::int n FROM asistentes
        WHERE telefono LIKE '665%' OR nombre IN ('SinTelefono','Nueva','Nuevo')`)).rows[0].n;
    ok(antes === 0, 'la simulación no escribió nada');

    r = await api('/api/admin/importar', {
      method: 'POST', body: JSON.stringify({ csv, confirmar: true }),
    });
    ok(r.status === 200 && r.body.nuevos === 4, 'importa las 4 filas buenas', r.body);
    ok(r.body.rechazadas.length === 1, 'reporta la fila sin nombre', r.body.rechazadas);

    r = await api('/api/admin/modulo/panorama');
    ok(r.body.de_lista_previa >= 4, 'el panorama cuenta la lista previa', r.body);

    // ---------------------------------------------------------------
    seccion('4. Buscar en la mesa de entrega');

    r = await api('/api/admin/modulo/buscar?q=solis beltran');
    const ricardo = r.body.resultados.find((x) => x.telefono === '6650000001');
    ok(!!ricardo, 'encuentra escribiendo sin acento', r.body.resultados.length);
    ok(ricardo && ricardo.nombre === 'Ricardo', 'trae al asistente correcto');

    r = await api('/api/admin/modulo/buscar?q=torre');
    ok(r.body.resultados.some((x) => x.telefono === '6650000002'),
       'encuentra por apellido con partícula');

    r = await api('/api/admin/modulo/buscar?q=' + encodeURIComponent('MAURICIO RÍOS'));
    ok(r.body.resultados.some((x) => x.telefono === '6650000003'),
       'encuentra escribiendo con acento y mayúsculas');

    r = await api('/api/admin/modulo/buscar?q=' + encodeURIComponent('Inmobiliaria Costa'));
    ok(r.body.resultados.some((x) => x.telefono === '6650000001'), 'encuentra por empresa');

    r = await api('/api/admin/modulo/buscar?q=' + encodeURIComponent(ricardo.codigo_corto));
    ok(r.body.resultados.some((x) => x.id === ricardo.id), 'encuentra por código corto');

    r = await api('/api/admin/modulo/buscar?q=zzzz');
    ok(r.body.resultados.length === 0, 'no inventa resultados');

    r = await api('/api/admin/modulo/buscar?q=a');
    ok(r.body.resultados.length === 0, 'una sola letra no dispara la búsqueda');

    // ---------------------------------------------------------------
    seccion('5. Etiquetas pendientes e impresión');

    r = await api('/api/admin/modulo/etiquetas');
    const pendientes = r.body.etiquetas.filter((e) => String(e.qr_id).length === 24);
    ok(r.body.total >= 4, 'lista las etiquetas pendientes', r.body.total);
    ok(pendientes.every((e) => e.etiqueta_impresa_en === null),
       'todas las pendientes están sin imprimir');

    const ids = [ricardo.id];
    r = await api('/api/admin/modulo/etiquetas/impresas', {
      method: 'POST', body: JSON.stringify({ ids }),
    });
    ok(r.body.marcadas === 1, 'marca el lote como impreso', r.body);

    r = await api('/api/admin/modulo/etiquetas');
    ok(!r.body.etiquetas.some((e) => e.id === ricardo.id),
       'el impreso ya no aparece en pendientes');

    r = await api('/api/admin/modulo/etiquetas?filtro=todos');
    ok(r.body.etiquetas.some((e) => e.id === ricardo.id),
       'pero sigue disponible en el filtro de todos');

    r = await api('/api/admin/modulo/etiquetas/impresas', {
      method: 'POST', body: JSON.stringify({ ids: [] }),
    });
    ok(r.body.marcadas === 0, 'lote vacío no truena');

    r = await api('/api/admin/modulo/etiquetas/impresas', {
      method: 'POST', body: JSON.stringify({ ids: ['abc', -5, 999999] }),
    });
    ok(r.status === 200 && r.body.marcadas === 0, 'ids basura se ignoran sin error', r.body);

    // ---------------------------------------------------------------
    seccion('6. Etiqueta individual desde la mesa');

    r = await api('/api/admin/modulo/asistente/' + ricardo.id);
    ok(r.status === 200 && r.body.qr_id === ricardo.qr_id, 'entrega los datos del asistente');

    r = await api('/api/admin/modulo/asistente/999999');
    ok(r.status === 404, 'id inexistente devuelve 404');

    r = await api('/api/admin/modulo/asistente/abc');
    ok(r.status === 400, 'id inválido devuelve 400');

    // Imprimir individual debe marcar la etiqueta
    const karla = (await api('/api/admin/modulo/buscar?q=karla de la torre'))
      .body.resultados.find((x) => x.telefono === '6650000002');
    await api('/api/admin/modulo/asistente/' + karla.id);
    const kq = await db.query('SELECT etiqueta_impresa_en FROM asistentes WHERE id = $1', [karla.id]);
    ok(kq.rows[0].etiqueta_impresa_en !== null,
       'imprimir individual marca la etiqueta como impresa');

    // ---------------------------------------------------------------
    seccion('7. Entrega del carnet');

    r = await api('/api/admin/modulo/entregar', {
      method: 'POST', body: JSON.stringify({ id: ricardo.id }),
    });
    ok(r.status === 200 && r.body.entregado_en, 'registra la entrega', r.body);
    ok(r.body.entregado_por, 'guarda quién la entregó', r.body.entregado_por);

    const primera = r.body.entregado_en;
    r = await api('/api/admin/modulo/entregar', {
      method: 'POST', body: JSON.stringify({ id: ricardo.id }),
    });
    ok(r.body.entregado_en === primera, 'entregar dos veces no cambia la hora original');

    r = await api('/api/admin/modulo/panorama');
    const entregados = r.body.entregados;
    ok(entregados >= 1, 'el panorama cuenta la entrega', r.body);

    r = await api('/api/admin/modulo/desentregar', {
      method: 'POST', body: JSON.stringify({ id: ricardo.id }),
    });
    ok(r.status === 200, 'se puede deshacer una entrega');

    r = await api('/api/admin/modulo/panorama');
    ok(r.body.entregados === entregados - 1, 'el panorama refleja el deshacer');

    r = await api('/api/admin/modulo/entregar', {
      method: 'POST', body: JSON.stringify({ id: 999999 }),
    });
    ok(r.status === 404, 'entregar a alguien inexistente devuelve 404');

    // ---------------------------------------------------------------
    seccion('8. Alta en vivo convive con la lista previa');

    const qr = require('crypto').randomBytes(12).toString('hex');
    await db.query(
      `INSERT INTO asistentes (qr_id, codigo_corto, nombre, apellido, telefono, estado, origen, datos_en)
       VALUES ($1,'ZZ9QQ1','Nuevo','EnVivo','6650000050','verificado','stand', now())`, [qr]
    );
    r = await api('/api/admin/modulo/panorama');
    ok(r.body.altas_en_vivo >= 1, 'distingue altas en vivo de la lista previa', {
      previa: r.body.de_lista_previa, vivo: r.body.altas_en_vivo,
    });

    r = await api('/api/admin/modulo/buscar?q=envivo');
    ok(r.body.resultados.some((x) => x.telefono === '6650000050'),
       'el alta en vivo también es buscable');

    // ---------------------------------------------------------------
    seccion('9. Reimportar con la lista actualizada');

    const csv2 = csv + ',Nueva,Persona,6650000004,Empresa Nueva\n';
    r = await api('/api/admin/importar', {
      method: 'POST', body: JSON.stringify({ csv: csv2, confirmar: true }),
    });
    ok(r.body.nuevos === 1, 'sólo agrega a la persona nueva', r.body);
    ok(r.body.sin_cambio >= 3, 'reconoce a los que ya estaban', r.body);

    const total = (await db.query(
      `SELECT count(*)::int n FROM asistentes
        WHERE telefono LIKE '665%' OR nombre IN ('SinTelefono','Nueva','Nuevo')`
    )).rows[0].n;
    ok(total === 6, 'no hay duplicados tras reimportar', total);

  } finally {
    await db.query(LIMPIAR);
    await db.end();
  }

  console.log('\n' + '='.repeat(52));
  console.log(`  ${pasaron} pruebas pasaron, ${fallaron} fallaron`);
  console.log('='.repeat(52) + '\n');
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
