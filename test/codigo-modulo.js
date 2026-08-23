'use strict';
/**
 * Pruebas del acceso al escáner por código de módulo — AMPI 2026.
 * Todos entran a la misma dirección /scan; el código identifica el stand.
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

async function api(ruta, opts = {}, cookie) {
  const r = await fetch(BASE + ruta, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const set = r.headers.get('set-cookie');
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { status: r.status, body, cookie: set ? set.split(';')[0] : null };
}

(async () => {
  const db = new Client({ connectionString: URL });
  await db.connect();

  try {
    seccion('1. Todos los módulos tienen código único');
    const { rows } = await db.query(
      'SELECT count(*)::int total, count(DISTINCT codigo)::int unicos, count(codigo)::int con FROM expositores'
    );
    ok(rows[0].total === rows[0].con, 'ningún módulo se quedó sin código', rows[0]);
    ok(rows[0].total === rows[0].unicos, 'todos los códigos son distintos', rows[0]);

    const fmt = await db.query(
      "SELECT count(*)::int n FROM expositores WHERE codigo !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'"
    );
    ok(fmt.rows[0].n === 0, 'todos usan el alfabeto sin caracteres confusos');

    const uno = await db.query('SELECT id, nombre, codigo, token FROM expositores WHERE activo LIMIT 1');
    const expo = uno.rows[0];

    seccion('2. Entrar con el código, desde la dirección general');
    let r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: expo.codigo }) });
    ok(r.status === 200 && r.body.expositor.id === expo.id, 'entra con su código', r.body);
    ok(!!r.cookie, 'recibe sesión');

    seccion('3. Tolerancia a cómo lo teclean');
    const variantes = [
      [expo.codigo.toLowerCase(), 'en minúsculas'],
      [' ' + expo.codigo + ' ', 'con espacios alrededor'],
      [expo.codigo.slice(0, 3) + '-' + expo.codigo.slice(3), 'con un guion en medio'],
    ];
    for (const [v, desc] of variantes) {
      const x = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: v }) });
      ok(x.status === 200, 'acepta el código ' + desc, x.body);
    }

    seccion('4. Rechazos');
    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: 'ZZZZZZ' }) });
    ok(r.status === 401 && /no reconocido/i.test(r.body.error), 'código inexistente se rechaza', r.body);

    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: 'ABC' }) });
    ok(r.status === 400, 'código corto se rechaza con mensaje claro', r.body);

    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({}) });
    ok(r.status === 401 && /código/i.test(r.body.error), 'sin nada, pide el código', r.body);

    seccion('5. Un módulo desactivado no puede entrar');
    await db.query('UPDATE expositores SET activo = false WHERE id = $1', [expo.id]);
    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: expo.codigo }) });
    ok(r.status === 403, 'el código de un módulo desactivado se rechaza', r.body);
    await db.query('UPDATE expositores SET activo = true WHERE id = $1', [expo.id]);

    seccion('6. Las ligas ya repartidas siguen sirviendo');
    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ token: expo.token }) });
    ok(r.status === 200 && r.body.expositor.id === expo.id, 'la liga /s/<token> entra sin pedir PIN', r.body);

    seccion('7. Regenerar el código invalida el anterior');
    const login = await api('/api/admin/login', {
      method: 'POST', body: JSON.stringify({ email: 'admin@quantummkt.mx', password: 'ampi2026' }),
    });
    const ck = login.cookie;
    const anterior = expo.codigo;

    r = await api('/api/admin/expositores/' + expo.id + '/codigo', { method: 'POST' }, ck);
    ok(r.status === 200 && r.body.codigo !== anterior, 'genera un código distinto', r.body);
    const nuevo = r.body.codigo;

    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: anterior }) });
    ok(r.status === 401, 'el código anterior deja de funcionar');

    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: nuevo }) });
    ok(r.status === 200, 'el código nuevo funciona');

    seccion('8. Un módulo creado ahora nace con su código');
    r = await api('/api/admin/expositores', {
      method: 'POST', body: JSON.stringify({ nombre: 'PRUEBA Codigo Nuevo' }),
    }, ck);
    ok(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(r.body.codigo),
       'el alta entrega un código válido', r.body.codigo);
    const creado = r.body.expositor;

    r = await api('/api/scan/login', { method: 'POST', body: JSON.stringify({ codigo: creado.codigo }) });
    ok(r.status === 200, 'y ese código ya sirve para entrar');

    r = await api('/api/admin/expositores', {}, ck);
    const enPanel = r.body.find((x) => x.id === creado.id);
    ok(enPanel && enPanel.codigo === creado.codigo, 'el panel muestra el código del módulo');

    await db.query('DELETE FROM expositores WHERE id = $1', [creado.id]);

  } finally {
    await db.query("DELETE FROM expositores WHERE nombre LIKE 'PRUEBA %'");
    await db.end();
  }

  console.log('\n' + '='.repeat(52));
  console.log(`  ${pasaron} pruebas pasaron, ${fallaron} fallaron`);
  console.log('='.repeat(52) + '\n');
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
