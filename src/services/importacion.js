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
  // Lugar asignado en el salón. "numa" cubre la columna "NUM A" del
  // archivo de Summit, que trae fila y asiento juntos ("AAA 12").
  fila:     ['fila', 'row', 'seccion', 'zona'],
  asiento:  ['asiento', 'seat', 'silla', 'lugar', 'numasiento'],
  numa:     ['numa', 'numeroasiento', 'filaasiento'],
  // Invitados de honor: su etiqueta no lleva código. La columna del
  // archivo viene sin encabezado, así que también se acepta vacía.
  sinqr:    ['sinqr', 'noqr', 'nollevaqr', 'observaciones', 'nota', ''],
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
      fila: get('fila'),
      asiento: get('asiento'),
      numa: get('numa'),
      sinqr: get('sinqr'),
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
 * ¿Este asistente va sin código QR?
 *
 * Se acepta cualquier texto que lo diga: "NO LLEVA QR", "sin qr", "no".
 * El archivo lo trae escrito a mano, así que no conviene exigir un valor
 * exacto que alguien vaya a teclear distinto.
 */
function parseSinQr(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (!s) return false;
  return /NO\s*LLEVA|SIN\s*QR|NO\s*QR|^NO$|^X$/.test(s);
}

/**
 * Interpreta el lugar asignado.
 *
 * Acepta las dos formas del archivo de Summit: columnas FILA y ASIENTO
 * separadas, o una sola columna "NUM A" que trae ambas juntas ("AAA 12").
 * Si vienen las dos, mandan las separadas.
 *
 * La fila se normaliza a mayúsculas sin espacios: en el archivo aparecen
 * como AAA, AA, A … G, y un espacio de más al final rompería el orden.
 */
function parseLugar(f) {
  const limpiaFila = (v) => {
    const s = String(v == null ? '' : v).trim().toUpperCase();
    return /^[A-Z]{1,4}$/.test(s) ? s : null;
  };
  const limpiaAsiento = (v) => {
    const n = parseInt(String(v == null ? '' : v).trim(), 10);
    return Number.isInteger(n) && n > 0 && n <= 999 ? n : null;
  };

  let fila = limpiaFila(f.fila);
  let asiento = limpiaAsiento(f.asiento);

  if ((!fila || !asiento) && f.numa) {
    // "AAA 12", "AAA-12" o "AAA12"
    const m = String(f.numa).trim().toUpperCase().match(/^([A-Z]{1,4})\s*[-· ]?\s*(\d{1,3})$/);
    if (m) {
      fila = fila || m[1];
      asiento = asiento || parseInt(m[2], 10);
    }
  }

  // Un lugar a medias no sirve: o se sabe fila y asiento, o no hay lugar.
  return (fila && asiento) ? { fila, asiento } : { fila: null, asiento: null };
}

/**
 * Deja la fila lista para insertar, o explica por qué no sirve.
 * Nombre partido: si viene todo junto en `nombre`, se separa.
 */
function prepararFila(f) {
  let nombre = limpiarNombre(f.nombre);
  let apellido = limpiarNombre(f.apellido);

  // El archivo trae "Juan Pérez de la Torre" en una sola columna.
  //
  // Los títulos van CON el nombre de pila, no solos. Antes "Lic. René A.
  // Madrigal" quedaba como nombre="Lic." y apellido="René A. Madrigal":
  // los tres abogados de Notaría 8 terminaban con el mismo nombre y el
  // sistema los confundía entre sí al reimportar.
  if (nombre && !apellido && nombre.includes(' ')) {
    const partes = nombre.split(' ').filter(Boolean);
    const esTitulo = (p) =>
      /^(lic|ing|mtra|mtro|dr|dra|c\.?p|arq|prof|sr|sra|srta)\.?$/i.test(p);

    let corte = 1;                       // por omisión, la primera palabra
    if (partes.length > 2 && esTitulo(partes[0])) corte = 2;   // título + nombre

    nombre = partes.slice(0, corte).join(' ');
    apellido = partes.slice(corte).join(' ');
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
    ...parseLugar(f),
    sin_qr: parseSinQr(f.sinqr),
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
  //
  // El teléfono NO sirve por sí solo para detectarlos: en la lista de
  // Summit cinco personas de Next Bienes Raíces y tres de Notaría 8
  // comparten el conmutador de su oficina, y se rechazaban como si fueran
  // la misma persona. Ocho asistentes reales se habrían quedado fuera.
  //
  // Se considera duplicado cuando coincide el qr_id, o cuando coinciden
  // nombre, apellido Y teléfono: ahí sí es la misma persona capturada dos
  // veces, no dos compañeros de trabajo.
  const vistosQr = new Set();
  const vistosPersona = new Set();
  const aInsertar = [];
  const duplicadosArchivo = [];

  const clavePersona = (f) => [
    (f.nombre || '').toLowerCase(),
    (f.apellido || '').toLowerCase(),
    f.telefono || '',
  ].join('|');

  for (const f of validas) {
    const claveQr = f.qr_id;
    const persona = f.telefono ? clavePersona(f) : null;

    if ((claveQr && vistosQr.has(claveQr)) ||
        (persona && vistosPersona.has(persona))) {
      duplicadosArchivo.push({ linea: f.linea, motivo: 'duplicado_en_archivo' });
      continue;
    }
    if (claveQr) vistosQr.add(claveQr);
    if (persona) vistosPersona.add(persona);
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
        'SELECT id, nombre, apellido, telefono, email, empresa, fila, asiento, sin_qr, codigo_corto, estado FROM asistentes WHERE qr_id = $1',
        [f.qr_id]
      );
      existente = r.rows[0] || null;
    }
    // Mismo criterio que arriba: el teléfono solo no identifica a nadie
    // cuando varias personas comparten el conmutador de su oficina. Se
    // exige que también coincida el nombre.
    if (!existente && f.telefono) {
      const r = await client.query(
        `SELECT id, nombre, apellido, telefono, email, empresa, fila, asiento,
                codigo_corto, estado
           FROM asistentes
          WHERE telefono = $1
            AND unaccent_simple(coalesce(nombre,'')) = unaccent_simple($2)
            AND unaccent_simple(coalesce(apellido,'')) = unaccent_simple($3)
          LIMIT 1`,
        [f.telefono, f.nombre, f.apellido || '']
      );
      existente = r.rows[0] || null;
    }
    // Sin qr ni teléfono no hay clave natural. Antes de crear a alguien,
    // buscamos por nombre completo y empresa: es lo único que distingue a
    // un invitado que el organizador capturó sin datos de contacto.
    // Sin esto, cada reimportación creaba un duplicado silencioso.
    if (!existente && !f.telefono) {
      // El LUGAR forma parte de la identidad cuando existe.
      //
      // Las cortesías de patrocinador vienen sin nombre real: los siete
      // asientos de RUBA se llaman los siete "RUBA". Buscando sólo por
      // nombre y empresa, el segundo encontraba al primero y lo
      // actualizaba: los siete se colapsaban en uno solo y 79 personas
      // se quedaban fuera de la importación.
      //
      // Con fila y asiento en la condición, cada butaca es una persona
      // distinta, que es lo que son.
      const conLugar = f.fila && f.asiento;
      const r = await client.query(
        `SELECT id, nombre, apellido, telefono, email, empresa, fila, asiento,
                sin_qr, codigo_corto, estado
           FROM asistentes
          WHERE unaccent_simple(coalesce(nombre,'')) = unaccent_simple($1)
            AND unaccent_simple(coalesce(apellido,'')) = unaccent_simple($2)
            AND unaccent_simple(coalesce(empresa,''))  = unaccent_simple($3)
            ${conLugar
              ? 'AND (fila IS NULL OR (upper(fila) = $4 AND asiento = $5))'
              : ''}
          ORDER BY (fila IS NOT NULL) DESC
          LIMIT 1`,
        conLugar
          ? [f.nombre, f.apellido || '', f.empresa || '', f.fila, f.asiento]
          : [f.nombre, f.apellido || '', f.empresa || '']
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
      // El lugar sí se sobrescribe, a diferencia del resto. Es el dato que
      // más cambia: AMPI reacomoda el salón hasta el último día, y al
      // reimportar la lista corregida debe ganar la versión nueva.
      if (f.fila && f.asiento &&
          (existente.fila !== f.fila || existente.asiento !== f.asiento)) {
        campos.push(`fila = $${++n}`);    vals.push(f.fila);
        campos.push(`asiento = $${++n}`); vals.push(f.asiento);
      }

      // Estar en la lista del organizador ES la verificación: esa persona
      // está confirmada, aunque su registro se haya creado antes por un
      // escaneo suelto o por una importación que se cayó a medias.
      //
      // Sin esto quedaban como 'pendiente' para siempre y el tablero las
      // reportaba como sin identificar, aunque tuvieran nombre y lugar.
      if (existente.estado === 'pendiente') {
        campos.push(`estado = 'verificado'`);
      }
      // La marca de invitado de honor también se actualiza: AMPI puede
      // agregar o quitar autoridades hasta el último momento.
      if (existente.sin_qr !== f.sin_qr) {
        campos.push(`sin_qr = $${++n}`); vals.push(f.sin_qr);
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

      // SAVEPOINT antes de intentar.
      //
      // En PostgreSQL, CUALQUIER error dentro de una transacción la aborta
      // entera: las siguientes consultas devuelven "current transaction is
      // aborted" hasta el ROLLBACK. Sin este punto de retorno, la primera
      // colisión de código corto tumbaba toda la importación aunque el
      // catch pareciera manejarla.
      //
      // Con SAVEPOINT sólo se deshace el intento fallido y el bucle puede
      // reintentar con otro código.
      await client.query('SAVEPOINT alta_asistente');
      try {
        const r = await client.query(
          `INSERT INTO asistentes
             (qr_id, codigo_corto, nombre, apellido, telefono, email, empresa,
              fila, asiento, sin_qr, estado, origen, datos_en)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verificado','csv', now())
           RETURNING id, qr_id, codigo_corto, nombre, apellido, empresa,
                     fila, asiento, sin_qr`,
          [qr, codigo, f.nombre, f.apellido, f.telefono, f.email, f.empresa,
           f.fila, f.asiento, f.sin_qr]
        );
        await client.query('RELEASE SAVEPOINT alta_asistente');
        insertado = r.rows[0];
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT alta_asistente');
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
