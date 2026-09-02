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
