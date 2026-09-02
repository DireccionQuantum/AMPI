'use strict';
/**
 * Invitados de honor sin QR, nombres recortados y filtro por fila.
 * Se prueba contra el archivo real de Summit actualizado.
 */
const fs = require('fs');
const imp = require('../src/services/importacion.js');
const mod = require('../src/services/modulo.js');

let ok = 0, fail = 0;
const chk = (c, m, x) => { c ? (ok++, console.log('  ok    ' + m))
  : (fail++, console.log('  FALLA ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : ''))); };

const csv = fs.readFileSync('/mnt/user-data/outputs/summit-actualizado.csv', 'utf8');
const lect = imp.leerCsv(csv);
const filas = lect.filas.map(imp.prepararFila);
const validas = filas.filter((f) => f.ok);

console.log('=== 1. El archivo actualizado ===');
chk(!lect.error, 'se lee sin error', lect.error);
chk(validas.length === 191, 'las 191 personas son válidas', validas.length);
chk(filas.filter((f) => !f.ok).length === 0, 'ninguna rechazada');
chk(lect.columnas.sinqr !== undefined, 'reconoce la columna de la anotación');

console.log('\n=== 2. Invitados sin QR ===');
const sinQr = validas.filter((f) => f.sin_qr);
chk(sinQr.length === 27, 'detecta los 27 marcados', sinQr.length);
chk(sinQr.every((f) => f.fila && f.asiento), 'todos traen su asiento');
const filasSin = [...new Set(sinQr.map((f) => f.fila))].sort();
chk(filasSin.every((f) => f === 'AAA' || f === 'AA'),
    'todos están en las filas de adelante', filasSin);

console.log('\n=== 3. Formas de escribir la marca ===');
[['NO LLEVA QR', true], ['no lleva qr', true], ['SIN QR', true],
 ['sin qr', true], ['NO', true], ['X', true],
 ['', false], [null, false], ['confirmado', false], ['SI', false],
].forEach(([v, esperado]) => {
  const f = imp.prepararFila({ linea: 1, nombre: 'Prueba Uno', sinqr: v });
  chk(f.sin_qr === esperado, `«${v}» → ${esperado ? 'sin QR' : 'con QR'}`, f.sin_qr);
});

console.log('\n=== 4. Recorte de nombres largos ===');
// Misma lógica que la etiqueta, replicada para probarla sin navegador.
function nombreCorto(v) {
  if (!v || v.length <= 26) return v;
  const partes = v.split(' ').filter(Boolean);
  const titulos = /^(lic|ing|mtra|mtro|dr|dra|c\.?p|arq|prof)\.?$/i;
  const corto = [];
  if (partes.length && titulos.test(partes[0])) corto.push(partes.shift());
  if (partes.length) corto.push(partes.shift());
  if (partes.length >= 2) corto.push(partes[partes.length - 2]);
  else if (partes.length === 1) corto.push(partes[0]);
  const x = corto.join(' ');
  return (x.length >= 6 && x.length < v.length) ? x : v;
}
[
  ['Ing. Pedro Alejandro Montejo Peterson', 'Ing. Pedro Montejo'],
  ['Arq. Xavier Fernando Ibarra Quintana', 'Arq. Xavier Ibarra'],
  ['MARTHA ELIZETH ONTIVEROS RODRIGUEZ', 'MARTHA ONTIVEROS'],
  ['C.P. Yolanda Arroyo Rivera', 'C.P. Yolanda Arroyo Rivera'],   // ya cabe
  ['Dra. Haydee Mendoza', 'Dra. Haydee Mendoza'],
  ['Uria Amor', 'Uria Amor'],
].forEach(([entrada, esperado]) => {
  chk(nombreCorto(entrada) === esperado,
      `${entrada.length} car → «${esperado}»`, nombreCorto(entrada));
});

const todos = validas.map((f) => nombreCorto([f.nombre, f.apellido].filter(Boolean).join(' ')));
chk(todos.every((n) => n.length <= 30),
    'ningún nombre pasa de 30 caracteres tras el recorte',
    todos.filter((n) => n.length > 30));
chk(todos.every((n) => n.trim().split(' ').length >= 2 || n.length < 12),
    'todos conservan al menos nombre y apellido');

console.log('\n=== 5. Órdenes de impresión ===');
chk(typeof mod.ORDENES === 'object', 'el servicio expone los órdenes');
chk(mod.ORDENES.lugar !== undefined, 'incluye el orden por lugar del salón');
chk(typeof mod.filasDelSalon === 'function', 'expone las filas del salón');

console.log('\n=== 6. Compañeros con el mismo teléfono ===');
// El índice único sobre telefono impedía darlos de alta: seis personas
// de la fila E se quedaban fuera aunque el importador ya no las
// rechazara. La migración 007 lo cambia por uno de nombre+apellido+tel.
const filaE = validas.filter((f) => f.fila === 'E');
chk(filaE.length === 20, 'la fila E trae sus 20 asientos', filaE.length);

const porTel = new Map();
validas.forEach((f) => {
  if (!f.telefono) return;
  porTel.set(f.telefono, (porTel.get(f.telefono) || 0) + 1);
});
const compartidos = [...porTel.values()].filter((n) => n > 1).length;
chk(compartidos === 2, 'hay 2 teléfonos compartidos por varias personas', compartidos);

// Nadie repite nombre+apellido+teléfono: el índice nuevo es viable.
const claves = new Map();
validas.forEach((f) => {
  if (!f.telefono) return;
  const k = [(f.nombre || '').toLowerCase(), (f.apellido || '').toLowerCase(), f.telefono].join('|');
  claves.set(k, (claves.get(k) || 0) + 1);
});
chk([...claves.values()].every((n) => n === 1),
    'ninguna persona repetida de verdad: el índice único es viable');

console.log('\n' + '='.repeat(54));
console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
console.log('='.repeat(54));
process.exit(fail ? 1 : 0);
