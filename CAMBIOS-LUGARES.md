# Lugares asignados · AMPI Realty Summit 2026

Cambios sobre el sistema que ya estaba desplegado, para que el gafete
lleve impreso el lugar de cada persona.

## Qué se agregó

**Dos columnas nuevas** en `asistentes`: `fila` y `asiento`. No hay tabla
de butacas ni control de aforo: AMPI no pidió controlar el acceso a la
sala, sólo que el lugar venga impreso.

**El importador reconoce el lugar** en las tres formas del archivo de
Summit: columnas `FILA` y `ASIENTO` por separado, o la columna `NUM A`
que trae ambas juntas ("AAA 12", "B-7", "G20").

**La etiqueta muestra el lugar** en un recuadro junto al QR, en tamaño
grande para que quien orienta a la gente lo lea de lejos. Si la persona
no tiene lugar asignado, el recuadro desaparece y el QR crece para no
dejar espacio muerto.

**La tira por lote se puede ordenar** por nombre, apellido, lugar en el
salón, o el orden en que se capturaron. Sale de la impresora en ese
orden, así queda apilada igual sobre la mesa.

**La mesa de entrega ve el lugar** al buscar a la persona, para poder
decirle dónde sentarse al entregarle su gafete.

## Contactos de cada stand

Pestaña nueva en el panel: **Contactos**. Lista cada módulo con cuántas
personas escanearon su código, y cuántas dejaron teléfono o correo.

Cada módulo se descarga por separado, porque cada expositor sólo tiene
derecho a los contactos que él mismo levantó, no al padrón completo.

El archivo trae: nombre, apellidos, empresa, teléfono, correo, lugar
asignado y la hora en que visitó el stand. En hora de Tijuana, no UTC.

## Las etiquetas salían en blanco

Síntoma: en pantalla se veía bien, al imprimir salía la hoja vacía.

Causa: el código asignaba la imagen del QR y llamaba a imprimir 350 ms
después. Asignar `img.src` y tener la imagen dibujada son dos momentos
distintos: si el navegador tardaba más, se imprimía antes de que hubiera
nada que imprimir.

Arreglo: se espera al evento `onload` de la imagen, y además a que las
tipografías terminen de cargar. Sin esto último el texto puede salir con
la fuente de reserva o en blanco.

El lote tenía el mismo defecto y también quedó corregido; ahí era más
probable, porque son 185 imágenes en lugar de una.

## Dónde corta la impresora

El largo del corte **lo decide el controlador de la Brother, no el
diseño**. Se comprobó cambiando el alto de 55 a 42 mm: la tira salió
igual de larga, sólo con el contenido más chico.

Para que corte a 55 mm hay que crear un tamaño de papel personalizado en
macOS (Tamaño del papel → Administrar tamaños personalizados): 62 de
ancho, 55 de alto, márgenes en cero. Y guardarlo como predeterminado.

Si el diálogo de Chrome no muestra esa opción, usar «Imprimir usando el
diálogo del sistema», que es el nativo de macOS y siempre la tiene.

## Invitados sin QR

Las 27 autoridades de las filas AAA y AA reciben carnet con nombre y
asiento, pero sin código: no visitan módulos ni entran a las rifas.

Se marca en el archivo con la anotación «NO LLEVA QR» en una columna
extra. El importador también acepta «SIN QR», «NO» o «X».

En su etiqueta el asiento ocupa el lugar del código y se imprime en
grande: es lo único que necesitan ver al llegar a su fila.

Quedan excluidos del sorteo desde la vista , no desde
cada consulta suelta.

## Nombres largos

Los que pasan de 26 caracteres se recortan a título, nombre de pila y
primer apellido: «Ing. Pedro Alejandro Montejo Peterson» queda como
«Ing. Pedro Montejo». Se conserva el título porque en este público
importa, y el apellido porque es lo que identifica a alguien en la mesa.

## Imprimir por fila

El lote tiene un selector con las filas del salón y cuántas etiquetas
faltan en cada una, para ir armando los carnets por secciones.

### Las migraciones fallaban al recrear vistas

Síntoma: `cannot drop columns from view` (código 42P16) al correr
`npm run migrate`.

Causa: `CREATE OR REPLACE VIEW` sólo funciona si la vista conserva
exactamente las mismas columnas. `v_operacion_modulo` se redefine en
tres migraciones distintas, agregando una columna cada vez, y
`v_expositores` en dos.

Arreglo: `DROP VIEW IF EXISTS` antes de cada creación.

## Impresión una por una

Casilla en el lote, activada por omisión. Manda un trabajo de impresión
por etiqueta en vez de la tira completa, así la QL-800 corta al terminar
cada una y salen ya sueltas.

Sin ella, el corte se acumula y hay que ir separando a mano.

### El botón se quedaba desactivado al filtrar

El contador esperaba a que se dibujaran tantos QR como etiquetas
hubiera, pero los 27 invitados de honor no generan imagen. Nunca llegaba
a cero y el botón no se habilitaba. Ahora sólo cuenta las que sí llevan
código.

### La base bloqueaba los teléfonos compartidos

Seis personas de la fila E no entraban aunque el importador ya no las
rechazara: `ix_asis_tel` era un índice ÚNICO sobre `telefono`, así que
PostgreSQL impedía dos registros con el mismo número.

Los compañeros de una oficina registran el conmutador de su empresa:
cinco de Next Bienes Raíces y tres de Notaría 8 en esta lista.

La migración 007 lo cambia por un índice único de nombre + apellido +
teléfono, que sí distingue un duplicado real de dos compañeros.

**Hay que correr `npm run migrate` antes de reimportar.**

## Cómo aplicarlo

```
npm run migrate      # aplica sql/005_lugares.sql
```

Después, desde el panel, importar el archivo de Summit. Reimportar la
lista corregida sobrescribe el lugar: es el dato que más cambia, porque
el salón se reacomoda hasta el último día.

## Un arreglo que salió en el camino

Un nombre del archivo venía con caracteres invisibles (`U+2060`, unión de
palabras) que se cuelan al copiar desde Word o WhatsApp. El importador lo
rechazaba como nombre inválido sin que se viera nada raro en el archivo.
Ahora esos caracteres se limpian antes de validar.

Sin ese arreglo, Alain Ricardo Meza Ochoa se habría quedado fuera de la
importación y nadie habría entendido por qué.

## El archivo de Summit

185 personas, nueve filas de veinte asientos (AAA, AA, A, B … G).

- 180 con lugar asignado, 5 sin lugar
- Sin asientos duplicados
- Leslie Pelayo aparece dos veces, en D-4 y D-6, con la misma empresa:
  confirmar con AMPI si son dos personas o un asiento de más
- El cargo más largo tiene 113 caracteres y se recorta a 80

## Pruebas

`node test/lugares.js` — 23 pruebas contra el archivo real, sin base de
datos. Cubre la lectura de las columnas, las tres formas de escribir el
lugar, y los casos que deben rechazarse.
