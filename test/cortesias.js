/**
 * Cortesías de patrocinador: varias personas con el mismo nombre.
 *
 * Las 85 cortesías del día 2 vienen sin nombre real, así que los siete
 * asientos de RUBA se llaman los siete "RUBA". Buscando existentes sólo
 * por nombre y empresa, el segundo encontraba al primero y lo
 * actualizaba: los siete se colapsaban en uno y 79 personas se quedaban
 * fuera. El lugar asignado es lo que las distingue.
 */
const fs = require('fs');
const imp = require('../src/services/importacion.js');

/** Base falsa que imita el comportamiento real de las consultas. */
function baseFalsa() {
  const filas = [];
  let seq = 0;
  return {
    filas,
    async query(sql, args) {
      const s = String(sql).replace(/\s+/g, ' ').toUpperCase();
      const norm = (v) => String(v == null ? '' : v).toLowerCase().trim();

      if (s.startsWith('SAVEPOINT') || s.startsWith('RELEASE') ||
          s.startsWith('ROLLBACK') || s.startsWith('SELECT CLAVE')) return { rows: [] };

      if (s.includes('FROM ASISTENTES WHERE QR_ID')) return { rows: [] };

      if (s.includes('WHERE TELEFONO = $1')) {
        const r = filas.filter(f => f.telefono === args[0] &&
          norm(f.nombre) === norm(args[1]) && norm(f.apellido) === norm(args[2]));
        return { rows: r.slice(0, 1) };
      }

      // La búsqueda por nombre + empresa (+ lugar)
      if (s.includes('UNACCENT_SIMPLE(COALESCE(EMPRESA')) {
        const conLugar = args.length === 5;
        let r = filas.filter(f =>
          norm(f.nombre) === norm(args[0]) &&
          norm(f.apellido) === norm(args[1]) &&
          norm(f.empresa) === norm(args[2]));
        if (conLugar) {
          r = r.filter(f => f.fila == null ||
            (String(f.fila).toUpperCase() === args[3] && f.asiento === args[4]));
        }
        return { rows: r.slice(0, 1) };
      }

      if (s.startsWith('INSERT INTO ASISTENTES')) {
        const f = { id: ++seq, qr_id: args[0], codigo_corto: args[1],
          nombre: args[2], apellido: args[3], telefono: args[4],
          email: args[5], empresa: args[6], fila: args[7], asiento: args[8],
          sin_qr: args[9] };
        filas.push(f);
        return { rows: [f] };
      }

      if (s.startsWith('UPDATE ASISTENTES')) return { rows: [] };
      return { rows: [] };
    },
  };
}

(async () => {
  const csv = fs.readFileSync(__dirname + '/datos/summit-dia2.csv', 'utf8');
  const db = baseFalsa();
  const r = await imp.importar(db, csv, { confirmar: true });
  console.log('IMPORTACIÓN SIMULADA CONTRA BASE VACÍA');
  console.log('  leídas      :', r.leidas);
  console.log('  nuevos      :', r.nuevos);
  console.log('  actualizados:', r.actualizados);
  console.log('  sin cambio  :', r.sin_cambio);
  console.log('  rechazadas  :', r.rechazadas.length);
  console.log('  EN LA BASE  :', db.filas.length, '(deben ser 109)');
  const pf = {};
  db.filas.forEach(f => { pf[f.fila] = (pf[f.fila] || 0) + 1; });
  console.log('  por fila    :', Object.entries(pf)
    .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(e => e[0] + ':' + e[1]).join(' '));
})();

// Segunda pasada: reimportar el mismo archivo no debe duplicar
(async () => {
  const fs2 = require('fs');
  const csv2 = fs2.readFileSync(__dirname + '/datos/summit-dia2.csv', 'utf8');
  const db2 = baseFalsa();
  await imp.importar(db2, csv2, { confirmar: true });
  const antes = db2.filas.length;
  const r2 = await imp.importar(db2, csv2, { confirmar: true });
  console.log('');
  console.log('SEGUNDA IMPORTACIÓN DEL MISMO ARCHIVO');
  console.log('  antes:', antes, '| después:', db2.filas.length);
  console.log('  nuevos:', r2.nuevos, '(deben ser 0)');
  console.log('  ', db2.filas.length === antes ? 'no duplica' : 'DUPLICA');
})();
