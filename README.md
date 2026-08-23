# Gamificación AMPI Tijuana 2026

Sistema de gamificación con QR y rifas en vivo para el evento AMPI del
**3 de septiembre de 2026**. Los asistentes acumulan puntos visitando los
módulos de expositores; cada punto se convierte en boletos para rifas
programadas que se sortean automáticamente durante el día.

Desarrollado por **Quantum Marketing & Advertising** — quantummkt.mx

---

## Qué hace

| Pantalla | Ruta | Para quién |
|---|---|---|
| Portada | `/` | Todos |
| Registro | `/registro` | Asistente (autoservicio) |
| Mi panel | `/mi` · `/p/:token` · `/a/:qr_id` | Asistente |
| Escáner | `/scan` · `/s/:token` | Expositor |
| Estación | `/estacion` | Personal del evento |
| Administración | `/admin` | Organización |
| Proyección | `/pantalla` | Proyector del salón |
| Instructivo | `/instructivo` | Hoja imprimible para expositores |
| Etiqueta | `/etiqueta` | Sticker del asistente (impresora térmica) |

---

## Instalación local

Requiere Node 20+ y PostgreSQL 14+.

```bash
npm install
cp .env.example .env      # y edita DATABASE_URL
npm run migrate           # crea tablas y vistas
npm run seed              # 40 módulos, 4 rifas, usuarios
npm start
```

Abre `http://localhost:3000`.

El `seed` imprime las credenciales y genera `credenciales.csv` con el PIN
y la liga directa de cada módulo — ese archivo es lo que se le entrega a
cada expositor.

**Usuarios que crea el seed:**

- Admin: `admin@quantummkt.mx` / `ampi2026`
- Staff: `registro@quantummkt.mx` / `staff2026`

> Cambia ambas contraseñas antes del evento con `ADMIN_PASSWORD` y
> `STAFF_PASSWORD` en el entorno.

---

## Despliegue en Railway

1. Sube el repositorio a GitHub.
2. En Railway: **New Project → Deploy from GitHub repo**.
3. Agrega el plugin **PostgreSQL**. Railway inyecta `DATABASE_URL` solo.
4. Define las variables de entorno:

```
NODE_ENV=production
SESSION_SECRET=<cadena larga y aleatoria>
ADMIN_PASSWORD=<contraseña fuerte>
STAFF_PASSWORD=<contraseña fuerte>
```

5. En la consola de Railway, una sola vez:

```bash
npm run migrate && npm run seed
```

6. **Settings → Networking → Generate Domain.**

El arranque (`npm start`) y el apagado ordenado ante `SIGTERM` ya están
configurados: Railway puede redesplegar sin cortar peticiones a medias.

---

## Pruebas

```bash
npm run simular      # 41 pruebas de integración contra la base
bash test/e2e.sh     # 52 pruebas end-to-end por HTTP (servidor arriba)
```

`simular-evento.js` borra los datos transaccionales y recrea un evento
completo: 60 asistentes, ~420 escaneos, sorteos y verificación estadística
de la ponderación por boletos. **No lo corras contra producción.**

---

## Reglas del juego (configurables en `/admin` → Ajustes)

| Clave | Predeterminado | Qué hace |
|---|---|---|
| `puntos_por_boleto` | 1 | Puntos necesarios para generar un boleto |
| `min_modulos_rifa` | 0 | Módulos mínimos para entrar al sorteo |
| `excluir_ganadores` | si | Un ganador queda fuera de las siguientes rifas |
| `solo_verificados` | si | Sólo participa quien dejó nombre y teléfono |

---

## Decisiones de diseño que conviene conocer

**Un solo formato de identidad.** Todo asistente se identifica con
`qr_id`: 24 caracteres hexadecimales. Da igual si viene de un gafete de
WeChamber (que emite ObjectId de MongoDB) o si lo generamos nosotros al
registrar a alguien en el stand. El escáner no distingue, así que el
sistema opera con o sin los gafetes del proveedor externo.

**El escaneo nunca se pierde.** Si llega un QR desconocido, se crea el
asistente como `pendiente` y se le suma el punto igual. La fila del
expositor no se detiene; los datos se completan después. Sólo los
asistentes verificados entran al sorteo, y eso es el incentivo para que
completen su registro.

**Los puntos se leen siempre de la base.** El navegador nunca envía un
valor de puntos; el servidor lo toma de `expositores.puntos`. Un
asistente sólo puede sumar una vez por módulo, garantizado por un
constraint `UNIQUE (asistente_id, expositor_id)` — no por lógica de
aplicación.

**El sorteo es por boleto, no por persona.** Quien visitó 20 módulos
tiene 20 veces más probabilidad que quien visitó uno. La selección usa
`crypto` con rechazo de muestras (sin sesgo de módulo) y la rifa se
bloquea con `SELECT ... FOR UPDATE` durante el sorteo: doble clic del
admin o coincidencia con el scheduler no la duplican.

**Sesión en tres capas.** Liga permanente con token de 128 bits guardada
en `localStorage` (cubre la mayoría de los casos), teléfono + código de
6 caracteres si cambió de dispositivo, y reemisión por el staff como
último recurso. El token se guarda hasheado con SHA-256, nunca en claro.

**Sin dependencias de CDN.** `html5-qrcode` y `qrcode` se sirven desde
`/lib/`. Si el WiFi del salón bloquea o ralentiza unpkg, el escáner y la
generación de QR siguen funcionando.

**El escáner tiene cola local.** Si se cae la red, el escaneo se guarda
en `localStorage` y se reenvía solo al reconectar, con aviso visible en
pantalla.

---

## Operación el día del evento

**Antes de abrir puertas**

- Entrega a cada expositor su liga `/s/<token>` y su PIN de 4 dígitos
  (están en `credenciales.csv`). Que la abran y dejen la pestaña fija.
- Abre `/pantalla` en la computadora del proyector, a pantalla completa.
- Abre `/estacion` en las tablets de la entrada, con sesión de staff.
- Verifica en `/admin` → Rifas que las horas y premios sean los correctos.

**Durante el evento**

- El tablero de `/admin` se actualiza solo cada 20 segundos.
- Vigila el contador **Sin identificar**: son asistentes con puntos pero
  sin datos. Si crece mucho, refuerza la estación de registro.
- Cada rifa se sortea sola a su hora. Si necesitas adelantarla, usa
  **Sortear ahora**; antes de confirmar verás cuántas personas y boletos
  hay en la urna.

**Al cerrar**

- `/admin` → Ganadores para el listado con teléfonos y marcar entregas.
- Exporta CSV de asistentes, ganadores y escaneos. El archivo lleva BOM,
  así que Excel respeta los acentos.

---

## Estructura

```
sql/001_schema.sql          Esquema completo (tablas, vistas, triggers)
src/server.js               Express + Socket.IO
src/db.js                   Pool de PostgreSQL y transacciones
src/services/
  vinculacion.js            Identidad, validación, registro
  sesion.js                 Tokens, códigos cortos, recuperación
  puntos.js                 Escaneos, boletos, métricas
  sorteo.js                 Motor de rifas
  scheduler.js              Disparo automático por hora
src/routes/                 scan · asistente · admin · publico
src/sockets/                Tiempo real
public/                     Las seis interfaces
scripts/                    migrate · seed · simular-evento · capturar
test/e2e.sh                 Pruebas por HTTP
```

---

## Marca e identidad

En **`/admin` → Marca** se suben tres logotipos sin necesidad de volver a
desplegar. Se guardan en PostgreSQL, no en disco, porque Railway recrea el
sistema de archivos en cada despliegue.

| Espacio | Dónde aparece |
|---|---|
| `logo_evento` | Barra del panel, proyección, instructivo |
| `logo_agencia` | Pie de las pantallas con fondo claro |
| `logo_agencia_claro` | Pie de la proyección y la portada |

El logo de Quantum ya viene incluido en `public/img/` en ambas versiones,
así que el crédito **Powered by Quantum Marketing** funciona desde el
primer arranque. Subir uno desde el panel simplemente lo reemplaza.

Los textos (nombre de la agencia, crédito, sitio, sede) también se editan
desde esa pestaña.

### Instructivo para expositores

`/instructivo` genera una hoja tamaño carta lista para imprimir o guardar
en PDF. Se personaliza por módulo:

```
/instructivo?modulo=Inmobiliaria+Costa+Azul&pin=3994&t=<token>
```

Desde **`/admin` → Módulos** hay un botón **Instructivo** en cada fila que
la abre ya con los datos puestos. El PIN sólo se imprime si acabas de
generarlo en esa misma sesión: en la base vive hasheado y no se puede
recuperar.

## Impresión de etiquetas

`/etiqueta` genera un sticker de **62 × 50 mm** con el nombre, el QR, el
código de respaldo y los logos del evento y de Quantum. Desde la estación
de registro hay un botón **Imprimir etiqueta** que la abre y lanza la
impresión ya con los datos de la persona recién registrada.

**Hardware recomendado:** Brother QL-810W (o QL-820NWB) con rollo continuo
**DK-2205** de 62 mm. Es impresión térmica directa: no usa tinta ni tóner.
Un rollo rinde unas 600 etiquetas, alrededor de $0.80 MXN cada una.

**Configuración de impresión (una sola vez por equipo):** en el diálogo del
navegador, elegir la Brother QL, papel de 62 mm, escala 100 %, sin
márgenes ni encabezados. Guardarlo como predeterminado.

Como el térmico es monocromático, los logos se fuerzan a negro puro con
`filter:brightness(0)`; un logo a color saldría como gris punteado.
Si se quiere color, hay que mandar hacer rollos preimpresos con los logos
y dejar en blanco la zona del nombre y el QR.

Los parámetros se pasan por URL:

```
/etiqueta?qr=<qr_id>&nombre=José Luis&apellido=de la Torre&codigo=B4NQ7K&auto=1
```

`auto=1` dispara la impresión en cuanto el QR termina de dibujarse.

## Pendientes conocidos

- **Logos de patrocinadores**: la tabla `patrocinadores` tiene `logo_url`
  pero las pantallas hoy muestran sólo el nombre. El sistema de carga de
  la pestaña Marca podría extenderse a cada patrocinador.
- **Notificación al ganador**: el aviso llega por Socket.IO si el
  asistente tiene su panel abierto. No hay SMS ni WhatsApp automático.
- **Import de CSV de WeChamber**: el endpoint `/api/admin/import` está
  declarado en el diseño pero no implementado, porque a la fecha no se
  confirmó si el proveedor exporta el ObjectId. El sistema opera sin él.
