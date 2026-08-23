'use strict';
/**
 * Pruebas de gestión de usuarios del panel — AMPI 2026
 * Especial atención a lo que podría dejar a Gabriel fuera de su propio sistema.
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
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
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
  await db.query("DELETE FROM usuarios WHERE email LIKE '%@prueba.test'");

  try {
    seccion('1. Sin sesión no se pasa');
    let r = await api('/api/admin/usuarios');
    ok(r.status === 403, 'listar usuarios exige sesión', r.status);

    seccion('2. Entra el administrador');
    r = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@quantummkt.mx', password: 'ampi2026' }),
    });
    ok(r.status === 200, 'sesión de admin', r.body);
    const yo = (await api('/api/admin/usuarios')).body.yo;
    ok(Number.isInteger(yo), 'la API dice quién soy');

    seccion('3. Crear practicantes');
    r = await api('/api/admin/usuarios', {
      method: 'POST',
      body: JSON.stringify({
        email: 'practicante1@prueba.test', nombre: 'Ana Practicante',
        password: 'atomo-lago-42', rol: 'staff',
      }),
    });
    ok(r.status === 201 && r.body.usuario.rol === 'staff', 'crea un practicante', r.body);
    const ana = r.body.usuario;

    r = await api('/api/admin/usuarios', {
      method: 'POST',
      body: JSON.stringify({
        email: 'PRACTICANTE2@Prueba.TEST', nombre: '  Luis   Gómez  ',
        password: 'sierra-nube-77',
      }),
    });
    ok(r.body.usuario.email === 'practicante2@prueba.test', 'normaliza el correo a minúsculas');
    ok(r.body.usuario.nombre === 'Luis Gómez', 'limpia espacios del nombre');
    ok(r.body.usuario.rol === 'staff', 'sin rol indicado, queda como staff');

    seccion('4. Validaciones al crear');
    const malos = [
      [{ email: 'no-es-correo', nombre: 'X Y', password: 'atomo-lago-42' }, 'correo inválido'],
      [{ email: 'a@prueba.test', nombre: 'A', password: 'atomo-lago-42' }, 'nombre de una letra'],
      [{ email: 'b@prueba.test', nombre: 'Bien', password: 'corta' }, 'contraseña corta'],
      [{ email: 'c@prueba.test', nombre: 'Bien', password: '12345678' }, 'contraseña sólo números'],
    ];
    for (const [cuerpo, desc] of malos) {
      const x = await api('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(cuerpo) });
      ok(x.status === 400, 'rechaza ' + desc, x.body);
    }

    r = await api('/api/admin/usuarios', {
      method: 'POST',
      body: JSON.stringify({
        email: 'practicante1@prueba.test', nombre: 'Repetida', password: 'atomo-lago-42',
      }),
    });
    ok(r.status === 400 && /ya está registrado/.test(r.body.error), 'rechaza correo duplicado', r.body);

    seccion('5. El practicante puede entrar y usar la mesa');
    const cookieAdmin = cookie;
    cookie = '';
    r = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'practicante1@prueba.test', password: 'atomo-lago-42' }),
    });
    ok(r.status === 200, 'el practicante entra con su contraseña', r.body);

    r = await api('/api/admin/modulo/buscar?q=zzz');
    ok(r.status === 200, 'el practicante SÍ puede usar la mesa de entrega', r.status);

    r = await api('/api/admin/usuarios');
    ok(r.status === 403, 'el practicante NO puede ver usuarios', r.status);

    r = await api('/api/admin/importar', {
      method: 'POST', body: JSON.stringify({ csv: 'Nombre\nX\n', confirmar: true }),
    });
    ok(r.status === 403, 'el practicante NO puede importar', r.status);

    cookie = cookieAdmin;

    seccion('6. Protecciones contra quedarse fuera');
    r = await api('/api/admin/usuarios/' + yo + '/activo', {
      method: 'POST', body: JSON.stringify({ activo: false }),
    });
    ok(r.status === 400 && /tu propia cuenta/.test(r.body.error),
       'no puedo desactivarme a mí mismo', r.body);

    r = await api('/api/admin/usuarios/' + yo + '/rol', {
      method: 'POST', body: JSON.stringify({ rol: 'staff' }),
    });
    ok(r.status === 400, 'no puedo quitarme mi propio rol de admin', r.body);

    // Con un segundo admin, degradarse sigue bloqueado para uno mismo,
    // pero desactivar al otro sí debe permitirse.
    r = await api('/api/admin/usuarios', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin2@prueba.test', nombre: 'Segundo Admin',
        password: 'valle-tigre-31', rol: 'admin',
      }),
    });
    const admin2 = r.body.usuario;
    ok(admin2.rol === 'admin', 'crea un segundo administrador');

    r = await api('/api/admin/usuarios/' + admin2.id + '/activo', {
      method: 'POST', body: JSON.stringify({ activo: false }),
    });
    ok(r.status === 200 && r.body.usuario.activo === false,
       'sí puedo desactivar a otro admin si quedo yo', r.body);

    seccion('7. Cambiar contraseña');
    r = await api('/api/admin/usuarios/' + ana.id + '/password', {
      method: 'POST', body: JSON.stringify({ password: 'nueva-clave-99' }),
    });
    ok(r.status === 200, 'el admin cambia la contraseña de un practicante');

    r = await api('/api/admin/usuarios/' + ana.id + '/password', {
      method: 'POST', body: JSON.stringify({ password: 'abc' }),
    });
    ok(r.status === 400, 'no acepta contraseña corta al cambiarla');

    const guardada = cookie;
    cookie = '';
    r = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'practicante1@prueba.test', password: 'nueva-clave-99' }),
    });
    ok(r.status === 200, 'la contraseña nueva funciona');
    cookie = '';
    r = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'practicante1@prueba.test', password: 'atomo-lago-42' }),
    });
    ok(r.status !== 200, 'la contraseña vieja ya no sirve', r.status);
    cookie = guardada;

    seccion('8. Desactivar bloquea el acceso');
    r = await api('/api/admin/usuarios/' + ana.id + '/activo', {
      method: 'POST', body: JSON.stringify({ activo: false }),
    });
    ok(r.status === 200, 'desactiva al practicante');

    const g2 = cookie;
    cookie = '';
    r = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'practicante1@prueba.test', password: 'nueva-clave-99' }),
    });
    ok(r.status !== 200, 'el desactivado ya no puede entrar', r.status);
    cookie = g2;

    seccion('9. Contraseña sugerida');
    const s = (await api('/api/admin/usuarios')).body.sugerida;
    ok(/^[a-z]+-[a-z]+-\d{2}$/.test(s), 'tiene formato dictable en voz alta', s);
    const s2 = (await api('/api/admin/usuarios')).body.sugerida;
    ok(s !== s2, 'cambia en cada consulta');

  } finally {
    await db.query("DELETE FROM usuarios WHERE email LIKE '%@prueba.test'");
    await db.end();
  }

  console.log('\n' + '='.repeat(52));
  console.log(`  ${pasaron} pruebas pasaron, ${fallaron} fallaron`);
  console.log('='.repeat(52) + '\n');
  process.exit(fallaron ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
