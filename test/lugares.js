'use strict';
/** Prueba del lugar asignado con el archivo real de Summit. */
const fs = require('fs');
const imp = require('../src/services/importacion.js');

let ok=0, fail=0;
const chk=(c,m,x)=>{c?(ok++,console.log('  ok    '+m)):(fail++,console.log('  FALLA '+m+(x!==undefined?'  → '+JSON.stringify(x):'')));};

const csv = fs.readFileSync('/tmp/summit.csv','utf8');
const r = imp.leerCsv(csv);

console.log('=== 1. Lectura del archivo real ===');
chk(!r.error, 'lee el archivo sin error', r.error);
chk(r.filas.length===185, 'encuentra las 185 personas', r.filas.length);
console.log('  columnas reconocidas:', Object.keys(r.columnas).join(', '));
chk(r.columnas.fila!==undefined, 'reconoce la columna FILA');
chk(r.columnas.asiento!==undefined, 'reconoce la columna ASIENTO');
chk(r.columnas.numa!==undefined, 'reconoce la columna NUM A');
chk(r.columnas.nombre!==undefined, 'reconoce NOMBRE');
chk(r.columnas.empresa!==undefined, 'reconoce EMPRESA');

console.log('\n=== 2. Interpretación del lugar ===');
const prep = r.filas.map(imp.prepararFila);
const validas = prep.filter(f=>f.ok);
chk(validas.length===185, 'las 185 filas son válidas', validas.length);

const conLugar = validas.filter(f=>f.fila && f.asiento);
const sinLugar = validas.filter(f=>!f.fila || !f.asiento);
chk(conLugar.length===180, '180 con lugar asignado', conLugar.length);
chk(sinLugar.length===5, 'y 5 sin lugar, como en el archivo', sinLugar.length);
console.log('  sin lugar:', sinLugar.map(f=>f.nombre+' '+(f.apellido||'')).join(' · '));

console.log('\n=== 3. Casos concretos ===');
const primero = validas[0];
chk(primero.fila==='AAA' && primero.asiento===1, 'primera persona en AAA-1', {f:primero.fila,a:primero.asiento});
const filas = [...new Set(conLugar.map(f=>f.fila))].sort();
chk(filas.length===9, 'las 9 filas del salón', filas.join(','));
const asientos = conLugar.map(f=>f.asiento);
chk(Math.min(...asientos)===1 && Math.max(...asientos)===20, 'asientos del 1 al 20');

console.log('\n=== 4. Formas de escribir el lugar ===');
const casos = [
  [{fila:'AAA', asiento:'12'}, 'AAA', 12, 'columnas separadas'],
  [{fila:' aaa ', asiento:' 5 '}, 'AAA', 5, 'con espacios y minúsculas'],
  [{numa:'AAA 12'}, 'AAA', 12, 'sólo NUM A con espacio'],
  [{numa:'B-7'}, 'B', 7, 'NUM A con guion'],
  [{numa:'G20'}, 'G', 20, 'NUM A sin separador'],
  [{fila:'C'}, null, null, 'fila sin asiento se descarta'],
  [{asiento:'9'}, null, null, 'asiento sin fila se descarta'],
  [{fila:'123', asiento:'4'}, null, null, 'fila numérica se rechaza'],
  [{fila:'A', asiento:'0'}, null, null, 'asiento cero se rechaza'],
];
casos.forEach(([entrada, ef, ea, desc])=>{
  const f = imp.prepararFila({linea:1, nombre:'Prueba Uno', ...entrada});
  chk(f.fila===ef && f.asiento===ea, desc, {fila:f.fila, asiento:f.asiento});
});

console.log('\n=== 5. Los datos difíciles del archivo ===');
const largo = validas.reduce((a,b)=> (b.nombre+' '+(b.apellido||'')).length > (a.nombre+' '+(a.apellido||'')).length ? b : a);
console.log('  nombre más largo:', largo.nombre, largo.apellido, '·', (largo.nombre+' '+largo.apellido).length, 'caracteres');
const emp = validas.filter(f=>f.empresa).reduce((a,b)=> b.empresa.length>a.empresa.length?b:a);
chk(emp.empresa.length<=80, 'la empresa se recorta a 80 caracteres', emp.empresa.length);

console.log('\n'+'='.repeat(52));
console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
console.log('='.repeat(52));
process.exit(fail?1:0);
