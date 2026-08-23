'use strict';

/**
 * Importación de la base previa — Gamificación AMPI 2026
 *
 * Recibe el listado que entrega el organizador (WeChamber o su propio Excel)
 * y da de alta a los asistentes ANTES del evento, para poder imprimir sus
 * etiquetas con anticipación.
 *
 * Reglas de oro:
 *   - El archivo es de un tercero: nada se da por bueno. Cada fila se valida
 *     con las mismas funciones que usa el registro en vivo.
 *   - Si la fila trae el ObjectId de WeChamber, se respeta como qr_id.
 *     Si no lo trae, emitimos uno nuestro con el mismo formato.
 *   - Importar dos veces el mismo archivo NO debe duplicar personas. Se
 *     reconoce por qr_id y, en su defecto, por teléfono.
 *   - Una fila mala no aborta la importación: se reporta y se sigue.
 */

const {
  generarQrId,
  parseQr,
  parseTelefono,
  limpiarNombre,
  limpiarEmail,
} = require('./vinculacion');

const { generarCodigoCorto } = require('./sesion');

const MAX_FILAS = 5000;

/* ------------------------------------------------------------------ *
 * Lectura de CSV
 * ------------------------------------------------------------------ */

/** Divide una línea de CSV respetando comillas y comas internas. */
function partirLinea(linea) {
  const out = [];
  let cur = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"') {
        if (linea[i + 1] === '"') { cur += '"'; i++; }
        else comillas = false;
      } else cur += ch;
    } else if (ch === '"') {
      comillas = true;
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Quita acentos y normaliza para comparar nombres de columna. */
function normalizarClave(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Sinónimos aceptados para cada campo. El cliente nunca manda el formato pedido. */
const ALIAS = {
  qr_id:    ['qrid', 'qr', 'id', 'objectid', 'idwechamber', 'folio', 'codigo', 'identificador'],
  nombre:   ['nombre', 'nombres', 'firstname', 'name', 'nombrecompleto'],
  apellido: ['apellido', 'apellidos', 'lastname', 'apellidopaterno'],
  telefono: ['telefono', 'tel', 'celular', 'movil', 'phone', 'whatsapp'],
  email:    ['email', 'correo', 'correoelectronico', 'mail'],
  empresa:  ['empresa', 'compania', 'organizacion', 'inmobiliaria', 'company'],
};

/** Mapea los encabezados reales del archivo a nuestros campos. */
function mapearColumnas(encabezados) {
  const mapa = {};
  encabezados.forEach((h, i) => {
    const k = normalizarClave(h);
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (mapa[campo] === undefined && alias.includes(k)) mapa[campo] = i;
    }
  });
  return mapa;
}

/**
 * Convierte el texto del archivo en filas con nuestros campos.
 * Devuelve { columnas, filas } sin tocar la base de datos.
 */
function leerCsv(texto) {
  if (typeof texto !== 'string' || !texto.trim()) {
    return { error: 'archivo_vacio' };
  }
  const lineas = texto
    .replace(/^\uFEFF/, '')            // BOM de Excel
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '');

  if (lineas.length < 2) return { error: 'sin_datos' };
  if (lineas.length - 1 > MAX_FILAS) return { error: 'demasiadas_filas' };

  const encabezados = partirLinea(lineas[0]);
  const mapa = mapearColumnas(encabezados);

  if (mapa.nombre === undefined && mapa.qr_id === undefined) {
    return { error: 'sin_columnas_reconocibles', encabezados };
  }

  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const celdas = partirLinea(lineas[i]);
    const get = (campo) =>
      mapa[campo] === undefined ? '' : (celdas[mapa[campo]] || '');
    filas.push({
      linea: i + 1,
      qr_id: get('qr_id'),
      nombre: get('nombre'),
      apellido: get('apellido'),
      telefono: get('telefono'),
      email: get('email'),
      empresa: get('empresa'),
    });
  }
  return { columnas: mapa, encabezados, filas };
}

/* ------------------------------------------------------------------ *
 * Validación de una fila
 * ------------------------------------------------------------------ */

function limpiarEmpresa(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  return v.length >= 2 && v.length <= 80 ? v.slice(0, 80) : null;
}

/**
 * Deja la fila lista para insertar, o explica por qué no sirve.
 * Nombre partido: si viene todo junto en `nombre`, se separa.
 */
function prepararFila(f) {
  let nombre = limpiarNombre(f.nombre);
  let apellido = limpiarNombre(f.apellido);

  // El archivo trae "Juan Pérez de la Torre" en una sola columna.
  if (nombre && !apellido && nombre.includes(' ')) {
    const partes = nombre.split(' ');
    nombre = partes[0];
    apellido = partes.slice(1).join(' ');
  }

  if (!nombre) return { ok: false, linea: f.linea, motivo: 'nombre_invalido' };

  // El qr_id del archivo sólo se acepta si cumple el formato. Si no, emitimos.
  const qrArchivo = f.qr_id ? parseQr(f.qr_id) : null;
  if (f.qr_id && !qrArchivo) {
    return { ok: false, linea: f.linea, motivo: 'qr_invalido', valor: f.qr_id };
  }

  return {
    ok: true,
    linea: f.linea,
    qr_id: qrArchivo,                       // null = se genera al insertar
    nombre,
    apellido: apellido || null,
    telefono: parseTelefono(f.telefono),
    email: limpiarEmail(f.email),
    empresa: limpiarEmpresa(f.empresa),
  };
}

/* ------------------------------------------------------------------ *
 * Importación contra la base
 * ------------------------------------------------------------------ */

/**
 * Inserta las filas válidas. Idempotente: reimportar el mismo archivo
 * actualiza datos faltantes en lugar de crear duplicados.
 *
 * @param {object} client  cliente de PostgreSQL dentro de una transacción
 * @param {string} texto   contenido del CSV
 * @param {object} opts    { simular: true } no escribe, sólo reporta
 */
async function importar(client, texto, opts = {}) {
  const lectura = leerCsv(texto);
  if (lectura.error) return { error: lectura.error, encabezados: lectura.encabezados };

  const preparadas = lectura.filas.map(prepararFila);
  const validas = preparadas.filter((f) => f.ok);
  const rechazadas = preparadas.filter((f) => !f.ok);

  // Duplicados dentro del propio archivo (pasa más seguido de lo que uno cree).
  const vistosQr = new Set();
  const vistosTel = new Set();
  const aInsertar = [];
  const duplicadosArchivo = [];
  for (const f of validas) {
    const claveQr = f.qr_id;
    const claveTel = f.telefono;
    if ((claveQr && vistosQr.has(claveQr)) || (claveTel && vistosTel.has(claveTel))) {
      duplicadosArchivo.push({ linea: f.linea, motivo: 'duplicado_en_archivo' });
      continue;
    }
    if (claveQr) vistosQr.add(claveQr);
    if (claveTel) vistosTel.add(claveTel);
    aInsertar.push(f);
  }

  const resumen = {
    leidas: lectura.filas.length,
    rechazadas: rechazadas.concat(duplicadosArchivo),
    nuevos: 0,
    actualizados: 0,
    sin_cambio: 0,
    creados: [],
  };

  if (opts.simular) {
    resumen.validas = aInsertar.length;
    return resumen;
  }

  for (const f of aInsertar) {
    // ¿Ya existe? Por qr_id del archivo, o por teléfono.
    let existente = null;
    if (f.qr_id) {
      const r = await client.query(
        'SELECT id, nombre, apellido, telefono, email, empresa, codigo_corto, estado FROM asistentes WHERE qr_id = $1',
        [f.qr_id]
      );
      existente = r.rows[0] || null;
    }
    if (!existente && f.telefono) {
      const r = await client.query(
        'SELECT id, nombre, apellido, telefono, email, empresa, codigo_corto, estado FROM asistentes WHERE telefono = $1',
        [f.telefono]
      );
      existente = r.rows[0] || null;
    }
    // Sin qr ni teléfono no hay clave natural. Antes de crear a alguien,
    // buscamos por nombre completo y empresa: es lo único que distingue a
    // un invitado que el organizador capturó sin datos de contacto.
    // Sin esto, cada reimportación creaba un duplicado silencioso.
    if (!existente && !f.telefono) {
      const r = await client.query(
        `SELECT id, nombre, apellido, telefono, email, empresa, codigo_corto, estado
           FROM asistentes
          WHERE unaccent_simple(coalesce(nombre,'')) = unaccent_simple($1)
            AND unaccent_simple(coalesce(apellido,'')) = unaccent_simple($2)
            AND unaccent_simple(coalesce(empresa,''))  = unaccent_simple($3)
          LIMIT 1`,
        [f.nombre, f.apellido || '', f.empresa || '']
      );
      existente = r.rows[0] || null;
    }

    if (existente) {
      // Sólo rellenamos huecos: no pisamos datos capturados en el stand.
      const campos = [];
      const vals = [];
      let n = 1;
      for (const k of ['nombre', 'apellido', 'telefono', 'email', 'empresa']) {
        if (!existente[k] && f[k]) { campos.push(`${k} = $${++n}`); vals.push(f[k]); }
      }
      if (campos.length) {
        await client.query(
          `UPDATE asistentes SET ${campos.join(', ')}, datos_en = COALESCE(datos_en, now()) WHERE id = $1`,
          [existente.id, ...vals]
        );
        resumen.actualizados++;
      } else {
        resumen.sin_cambio++;
      }
      continue;
    }

    // Alta nueva. qr_id propio si el archivo no trajo uno usable.
    let insertado = null;
    for (let intento = 0; intento < 6 && !insertado; intento++) {
      const qr = f.qr_id || generarQrId();
      const codigo = generarCodigoCorto();
      try {
        const r = await client.query(
          `INSERT INTO asistentes
             (qr_id, codigo_corto, nombre, apellido, telefono, email, empresa,
              estado, origen, datos_en)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'verificado','csv', now())
           RETURNING id, qr_id, codigo_corto, nombre, apellido, empresa`,
          [qr, codigo, f.nombre, f.apellido, f.telefono, f.email, f.empresa]
        );
        insertado = r.rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e;      // sólo reintentamos por colisión
        if (f.qr_id) {                        // el qr del archivo ya existe: no insistir
          resumen.sin_cambio++;
          break;
        }
      }
    }
    if (insertado) {
      resumen.nuevos++;
      resumen.creados.push(insertado);
    }
  }

  return resumen;
}

module.exports = {
  leerCsv,
  prepararFila,
  mapearColumnas,
  normalizarClave,
  partirLinea,
  importar,
  MAX_FILAS,
};
