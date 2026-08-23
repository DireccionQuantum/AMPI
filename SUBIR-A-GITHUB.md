# Cómo subir esto a GitHub (y que sí funcione)

Las veces anteriores el despliegue falló porque los archivos que están
**dentro de las subcarpetas** (`sql`, `src`, `public`) no se reemplazaron.
Este zip ya viene sin carpeta contenedora para evitar justo eso.

## Pasos

1. Descomprime el zip. Debes ver directamente estas carpetas y archivos:
   `public/  scripts/  sql/  src/  test/  package.json  Procfile  …`
   **No** debe haber una carpeta llamada `gamificacion-ampi` envolviendo todo.

2. En GitHub, entra a tu repositorio → **Add file** → **Upload files**.

3. Arrastra **el contenido**: selecciona todas las carpetas y archivos que
   viste en el paso 1 y suéltalos juntos. No arrastres la carpeta que los
   contiene.

4. Abajo escribe un mensaje (por ejemplo "actualización completa") y presiona
   **Commit changes**.

## Comprueba antes de que despliegue

Treinta segundos que te ahorran otro intento fallido. En GitHub, abre estos
tres archivos y busca el texto indicado:

| Archivo | Debe contener |
|---|---|
| `sql/001_schema.sql` | `DROP VIEW IF EXISTS v_expositores;` |
| `public/estacion.html` | `if (window.QRCode && d.qr_id)` |
| `scripts/migrate.js` | `Base no disponible` |

Si los tres están, el despliegue va a pasar.

## Un paso más en Railway, una sola vez

Tu base de datos todavía tiene la vista en el estado que rompe la migración.
Abre la pestaña **Console** del servicio y corre esto (una sola línea):

```
node -e "const {pool}=require('./src/db'); pool.query('DROP VIEW IF EXISTS v_expositores').then(()=>{console.log('vista borrada');return pool.end()})"
```

Debe responder `vista borrada`. No se pierde ningún dato: una vista es una
consulta guardada, no información. Los 40 módulos y sus códigos quedan igual.

Después de eso el pre-deploy (`npm run migrate`) funciona solo en cada
despliegue y no hay que volver a tocarlo.

## Después de desplegar, prueba esto

1. Entra a `/estacion`, registra a alguien de prueba.
2. Escanea el QR que aparece, desde `/scan` con el código de un módulo.
3. Debe decir el nombre de la persona y **no** debe aparecer ningún registro
   "Pendiente" sin nombre en la pestaña Asistentes.

Si aparece un pendiente vacío, el archivo `public/estacion.html` no se
actualizó.

## Limpieza pendiente

En la pestaña **Asistentes** borra los registros pendientes sin nombre ni
teléfono que se crearon durante las pruebas. Sus puntos venían de escaneos al
código equivocado, no de visitas reales.
