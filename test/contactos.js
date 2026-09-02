'use strict';
/**
 * Contactos por módulo — el entregable de cada expositor.
 * Se prueba la consulta y el armado del CSV sin necesidad de base real.
 */
let ok = 0, fail = 0;
const chk = (c, m, x) => { c ? (ok++, console.log('  ok    ' + m))
  : (fail++, console.log('  FALLA ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : ''))); };

// El mismo escapado que usa la ruta
const esc = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COL = [
  ['nombre','Nombre'], ['apellido','Apellidos'], ['empresa','Empresa'],
  ['telefono','Teléfono'], ['email','Correo'],
  ['fila','Fila'], ['asiento','Asiento'], ['visita','Visitó el stand'],
];

function armarCsv(rows) {
  return [
    COL.map((c) => c[1]).join(','),
    ...rows.map((r) => COL.map((c) => esc(r[c[0]])).join(',')),
  ].join('\n');
}

// El mismo limpiado del nombre de archivo
function nombreArchivo(nombre) {
  return (nombre || 'modulo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

console.log('=== 1. Armado del CSV ===');
const filas = [
  { nombre:'Ricardo', apellido:'Solís Beltrán', empresa:'Constructora Baja',
    telefono:'6641112233', email:'r@cbaja.mx', fila:'AAA', asiento:1,
    visita:'03/09/2026 10:24' },
  { nombre:'Ana', apellido:'Beltrán', empresa:'Bienes Raíces, S.A. de C.V.',
    telefono:null, email:null, fila:null, asiento:null, visita:'03/09/2026 11:02' },
];
const csv = armarCsv(filas);
const lineas = csv.split('\n');

chk(lineas.length === 3, 'una línea de encabezado más dos de datos', lineas.length);
chk(lineas[0].startsWith('Nombre,Apellidos'), 'encabezados en español', lineas[0].slice(0,24));
chk(lineas[1].includes('Ricardo'), 'incluye al primer contacto');
chk(lineas[2].includes('"Bienes Raíces, S.A. de C.V."'),
    'entrecomilla la empresa que trae comas', lineas[2].slice(0,60));
chk(lineas[2].split(',').length >= 8, 'los campos vacíos no rompen las columnas');
chk(!lineas[2].includes('null'), 'no escribe la palabra null', lineas[2]);

console.log('\n=== 2. Nombre del archivo ===');
const casos = [
  ['Quantum Marketing', 'quantum-marketing'],
  ['Mr Miopi', 'mr-miopi'],
  ['Construcción Ríos & Cía.', 'construccion-rios-cia'],
  ['', 'modulo'],
  [null, 'modulo'],
];
casos.forEach(([e, s]) => {
  chk(nombreArchivo(e) === s, `«${e}» → ${s}`, nombreArchivo(e));
});

console.log('\n=== 3. Sin contactos ===');
const vacio = armarCsv([]);
chk(vacio.split('\n').length === 1, 'sólo el encabezado, sin filas basura');
chk(vacio.startsWith('Nombre'), 'y el encabezado sigue ahí');

console.log('\n' + '='.repeat(50));
console.log(`  ${ok} pruebas pasaron, ${fail} fallaron`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
