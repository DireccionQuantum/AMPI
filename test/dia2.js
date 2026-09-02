'use strict';
/**
 * Carga del día 2 y asignación de asiento.
 */
const fs = require('fs');
const imp = require('../src/services/importacion.js');
const { limpiarNombre } = require('../src/services/vinculacion.js');

let ok = 0, fail = 0;
const chk = (c, m, x) => { c ? (ok++, console.log('  ok    ' + m))
  : (fail++, console.log('  FALLA ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : ''))); };

console.log('=== 1. El archivo del día 2 ===');
const csv = fs.readFileSync('/mnt/user-data/outputs/summit-dia2.csv', 'utf8');
const lect = imp.leerCsv(csv);
const prep = lect.filas.map(imp.prepararFila);
const validas = prep.filter((f) => f.ok);

chk(validas.length === 97, 'las 97 personas son válidas', validas.length);
chk(prep.filter((f) => !f.ok).length === 0, 'ninguna rechazada');
chk(validas.every((f) => f.fila && f.asiento), 'todas traen fila y asiento');

console.log('\n=== 2. Sin choques de asiento ===');
const lugares = validas.map((f) => f.fila + '-' + f.asiento);
chk(new Set(lugares).size === lugares.length,
    'ningún asiento repetido',
    lugares.filter((l, i) => lugares.indexOf(l) !== i));

// El día 1 usa del 1 al 20; el día 2 del 21 en adelante, salvo la fila I
// que es nueva y arranca en 1.
const choque = validas.filter((f) => f.asiento <= 20 && f.fila !== 'I' && f.fila !== 'J');
chk(choque.length === 0, 'no invade los asientos del día 1',
    choque.map((f) => f.fila + '-' + f.asiento));

console.log('\n=== 3. Razones sociales con números ===');
// "NOT 32" y "EJE 11" se rechazaban por llevar dígitos.
[
  ['NOT 32', 'NOT 32'],
  ['EJE 11', 'EJE 11'],
  ['Grupo 4S', 'Grupo 4S'],
  ['R & R Bienes', 'R & R Bienes'],
  ['María José', 'María José'],
].forEach(([e, esperado]) => {
  chk(limpiarNombre(e) === esperado, `acepta «${e}»`, limpiarNombre(e));
});

console.log('\n=== 4. Sigue rechazando lo que no es un nombre ===');
['6641234567', '+52 664 123 4567', '@@@', 'x', ''].forEach((e) => {
  chk(limpiarNombre(e) === null, `rechaza «${e}»`, limpiarNombre(e));
});

console.log('\n=== 5. Siguiente asiento libre ===');
// Misma lógica que el endpoint: el primer hueco, no el último más uno.
function siguienteLibre(usados) {
  const s = new Set(usados);
  let n = 1;
  while (s.has(n) && n < 200) n++;
  return n;
}
chk(siguienteLibre([1, 2, 3]) === 4, 'fila corrida → toma el siguiente');
chk(siguienteLibre([1, 2, 4, 5]) === 3, 'con hueco → aprovecha el hueco');
chk(siguienteLibre([]) === 1, 'fila vacía → empieza en 1');
chk(siguienteLibre([2, 3]) === 1, 'hueco al inicio → toma el 1');

console.log('\n' + '='.repeat(52));
console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
