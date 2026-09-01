'use strict';
/**
 * Reproduce la falla real: una colisión de código corto a media
 * importación. Sin SAVEPOINT, la transacción queda abortada y todas las
 * altas siguientes fallan con "current transaction is aborted".
 */
const imp = require('../src/services/importacion.js');

let ok=0, fail=0;
const chk=(c,m,x)=>{c?(ok++,console.log('  ok    '+m)):(fail++,console.log('  FALLA '+m+(x!==undefined?' → '+JSON.stringify(x):'')));};

/** Cliente falso que imita el comportamiento de PostgreSQL. */
function clienteFalso({ chocarEn = [] } = {}) {
  let abortada = false;
  let inserciones = 0;
  const savepoints = [];
  return {
    inserciones: () => inserciones,
    async query(sql, params) {
      const s = String(sql).trim().toUpperCase();

      if (s.startsWith('SAVEPOINT')) { savepoints.push(true); return { rows: [] }; }
      if (s.startsWith('RELEASE')) { savepoints.pop(); return { rows: [] }; }
      if (s.startsWith('ROLLBACK TO SAVEPOINT')) {
        abortada = false;                    // el savepoint limpia el aborto
        savepoints.pop();
        return { rows: [] };
      }

      // Así se comporta Postgres de verdad: una vez abortada, todo falla.
      if (abortada) {
        const e = new Error('current transaction is aborted, commands ignored until end of transaction block');
        e.code = '25P02';
        throw e;
      }

      if (s.startsWith('INSERT INTO ASISTENTES')) {
        inserciones++;
        if (chocarEn.includes(inserciones)) {
          abortada = true;                   // el error aborta la transacción
          const e = new Error('duplicate key value violates unique constraint');
          e.code = '23505';
          throw e;
        }
        return { rows: [{ id: inserciones, qr_id: params[0], codigo_corto: params[1],
                          nombre: params[2], apellido: params[3], empresa: params[6],
                          fila: params[7], asiento: params[8] }] };
      }
      return { rows: [] };                   // SELECT de existentes: nada
    },
  };
}

(async () => {
  const csv = [
    'FILA,ASIENTO,NOMBRE,EMPRESA,TELEFONO',
    'AAA,1,Ana Uno,Empresa A,6641110001',
    'AAA,2,Beto Dos,Empresa B,6641110002',
    'AAA,3,Carla Tres,Empresa C,6641110003',
    'AAA,4,Diego Cuatro,Empresa D,6641110004',
    'AAA,5,Elena Cinco,Empresa E,6641110005',
  ].join('\n');

  console.log('=== Sin colisiones ===');
  let c = clienteFalso();
  let r = await imp.importar(c, csv);
  chk(r.nuevos === 5, 'da de alta las 5', r.nuevos);

  console.log('\n=== Con colisión en la segunda alta ===');
  // Choca el intento 2; el bucle reintenta y lo logra en el 3.
  c = clienteFalso({ chocarEn: [2] });
  r = await imp.importar(c, csv);
  chk(r.nuevos === 5, 'las 5 entran igual, la colisión no tumba nada', r.nuevos);
  chk(r.rechazadas.length === 0, 'sin rechazos', r.rechazadas);

  console.log('\n=== Con tres colisiones repartidas ===');
  c = clienteFalso({ chocarEn: [2, 5, 8] });
  r = await imp.importar(c, csv);
  chk(r.nuevos === 5, 'sigue dando de alta las 5', r.nuevos);

  console.log('\n' + '='.repeat(50));
  console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
  console.log('='.repeat(50));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
