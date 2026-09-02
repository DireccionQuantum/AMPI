'use strict';
/**
 * Alta de prensa e invitados sin QR desde la estación de registro.
 * Se prueba con un cliente falso, sin base de datos.
 */
const v = require('../src/services/vinculacion.js');

let ok = 0, fail = 0;
const chk = (c, m, x) => { c ? (ok++, console.log('  ok    ' + m))
  : (fail++, console.log('  FALLA ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : ''))); };

/** Cliente que imita a PostgreSQL para esta operación. */
function cliente() {
  const insertados = [];
  return {
    insertados,
    async query(sql, args) {
      const s = String(sql).toUpperCase();
      if (s.includes('SELECT QR_ID FROM ASISTENTES')) return { rows: [] };
      if (s.includes('INSERT INTO ASISTENTES')) {
        insertados.push(args);
        return { rows: [{ id: insertados.length, qr_id: args[0], sin_qr: args[6] }] };
      }
      return { rows: [] };
    },
  };
}

const DATOS = { nombre: 'Laura', apellido: 'Medina', telefono: '6641234567' };

(async () => {
  console.log('=== Alta normal ===');
  let c = cliente();
  let r = await v.registrarNuevo(c, DATOS);
  chk(r.ok && !r.yaExistia, 'da de alta a la persona', r.errores);
  chk(r.sin_qr === false, 'con QR por omisión', r.sin_qr);
  chk(c.insertados[0][6] === false, 'la columna sin_qr guarda false');

  console.log('\n=== Alta de prensa ===');
  c = cliente();
  r = await v.registrarNuevo(c, DATOS, { sinQr: true });
  chk(r.ok, 'da de alta al invitado', r.errores);
  chk(r.sin_qr === true, 'marcado como sin QR', r.sin_qr);
  chk(c.insertados[0][6] === true, 'la columna sin_qr guarda true');

  console.log('\n=== La marca es explícita ===');
  for (const opts of [{}, { sinQr: false }, { sinQr: 'si' }, { sinQr: 1 }]) {
    c = cliente();
    r = await v.registrarNuevo(c, DATOS, opts);
    chk(r.sin_qr === false,
        `opts ${JSON.stringify(opts)} → lleva QR`, r.sin_qr);
  }

  console.log('\n=== Compañeros con el mismo teléfono ===');
  // La búsqueda de existentes ahora exige teléfono Y nombre: dos personas
  // de la misma oficina no deben confundirse entre sí.
  let consultas = [];
  const espia = {
    async query(sql, args) {
      const s = String(sql).toUpperCase();
      if (s.includes('SELECT QR_ID FROM ASISTENTES')) {
        consultas.push({ sql: sql.replace(/\s+/g, ' '), args });
        return { rows: [] };
      }
      if (s.includes('INSERT')) return { rows: [{ id: 1, qr_id: args[0], sin_qr: args[6] }] };
      return { rows: [] };
    },
  };
  await v.registrarNuevo(espia, DATOS);
  chk(consultas[0] && consultas[0].sql.includes('unaccent_simple'),
      'busca por teléfono Y nombre, no sólo teléfono',
      consultas[0] && consultas[0].sql);
  chk(consultas[0] && consultas[0].args.length === 2,
      'manda los dos parámetros', consultas[0] && consultas[0].args);

  console.log('\n=== Correo opcional en el alta ===');
  // El correo es opcional: sin él el alta debe funcionar igual, y con uno
  // inválido debe avisar en lugar de guardarlo mal.
  c = cliente();
  r = await v.registrarNuevo(c, DATOS);
  chk(r.ok, 'sin correo: se registra igual', r.errores);
  chk(c.insertados[0][4] === null, 'guarda el correo como vacío', c.insertados[0][4]);

  c = cliente();
  r = await v.registrarNuevo(c, { ...DATOS, email: '  LAURA@Empresa.MX ' });
  chk(r.ok, 'con correo válido: se registra', r.errores);
  chk(c.insertados[0][4] === 'laura@empresa.mx',
      'lo normaliza a minúsculas y sin espacios', c.insertados[0][4]);

  r = await v.registrarNuevo(cliente(), { ...DATOS, email: 'sin-arroba' });
  chk(!r.ok && r.errores && r.errores.email,
      'con correo inválido: avisa en lugar de guardarlo', r.errores);

  console.log('\n=== Empresa opcional ===');
  c = cliente();
  r = await v.registrarNuevo(c, DATOS);
  chk(r.ok && c.insertados[0][5] === null,
      'sin empresa: se registra igual', c.insertados[0][5]);

  c = cliente();
  r = await v.registrarNuevo(c, { ...DATOS, empresa: '  Grupo Constructor  ' });
  chk(c.insertados[0][5] === 'Grupo Constructor',
      'con empresa: la guarda sin espacios de sobra', c.insertados[0][5]);

  c = cliente();
  await v.registrarNuevo(c, { ...DATOS, empresa: 'x'.repeat(120) });
  chk(c.insertados[0][5].length === 80,
      'una empresa larguísima se recorta a 80', c.insertados[0][5].length);

  console.log('\n' + '='.repeat(52));
  console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
