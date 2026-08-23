# Guía de despliegue paso a paso

Sistema de Gamificación AMPI Tijuana 2026
Quantum Marketing & Advertising

**Tiempo estimado: 25 a 40 minutos.**

Sigue los pasos en orden. Cada uno tiene una verificación al final: no
pases al siguiente hasta que esa verificación te dé el resultado esperado.

---

## Antes de empezar

Ten a la mano:

- El archivo `gamificacion-ampi.zip`
- Tu cuenta de GitHub
- Tu cuenta de Railway (railway.app — si no tienes, se crea con GitHub)
- Una terminal (en tu Mac: Aplicaciones → Utilidades → Terminal)

Verifica que tienes Git instalado:

```bash
git --version
```

Si responde algo como `git version 2.39.5`, estás listo. Si dice
"command not found", instálalo desde https://git-scm.com/downloads

---

# PARTE 1 — Subir el código a GitHub

## Paso 1. Descomprimir el proyecto

Descomprime `gamificacion-ampi.zip` en tu carpeta de trabajo. Luego, en
la terminal, entra a la carpeta:

```bash
cd ~/Downloads/gamificacion-ampi
```

> Ajusta la ruta si lo descomprimiste en otro lado. Un truco: escribe
> `cd ` (con espacio) y arrastra la carpeta a la terminal.

**Verificación** — este comando debe listar `src`, `public`, `sql`,
`package.json`:

```bash
ls
```

---

## Paso 2. Confirmar que el `.env` no se va a subir

Esto es importante: el archivo `.env` lleva contraseñas y **nunca** debe
llegar a GitHub. El proyecto ya trae un `.gitignore` que lo bloquea.

```bash
cat .gitignore
```

**Verificación** — en la lista debe aparecer `.env`. Si no aparece, no
continúes: avísame.

---

## Paso 3. Crear el repositorio local

```bash
git init
git add .
git commit -m "Sistema de gamificación AMPI Tijuana 2026"
```

**Verificación** — el último comando debe decir algo como
`33 files changed`. Ahora confirma que el `.env` quedó fuera:

```bash
git ls-files | grep "^.env"
```

Debe responder únicamente `.env.example`. **Si aparece `.env` a secas,
detente** y ejecuta `git rm --cached .env` antes de seguir.

---

## Paso 4. Crear el repositorio en GitHub

1. Entra a https://github.com/new
2. **Repository name:** `gamificacion-ampi`
3. **Description:** Sistema de gamificación con QR y rifas — AMPI Tijuana 2026
4. Marca **Private** (el código es de un cliente)
5. **NO** marques ninguna casilla de "Initialize this repository"
   (nada de README, .gitignore ni licencia — ya los tenemos)
6. Clic en **Create repository**

En la pantalla que aparece, copia la URL que termina en `.git`. Se ve así:

```
https://github.com/TU-USUARIO/gamificacion-ampi.git
```

---

## Paso 5. Subir el código

Sustituye la URL por la tuya:

```bash
git remote add origin https://github.com/TU-USUARIO/gamificacion-ampi.git
git branch -M main
git push -u origin main
```

Si te pide usuario y contraseña, GitHub ya no acepta la contraseña normal:
necesitas un token. Se saca en
**GitHub → Settings → Developer settings → Personal access tokens →
Tokens (classic) → Generate new token**, marcando el permiso `repo`.
Ese token se pega donde pide la contraseña.

**Verificación** — recarga la página de tu repositorio en GitHub. Debes
ver las carpetas del proyecto y el README.

---

# PARTE 2 — Desplegar en Railway

## Paso 6. Crear el proyecto

1. Entra a https://railway.app y firma con GitHub
2. **New Project → Deploy from GitHub repo**
3. Si es tu primera vez, Railway pedirá permiso para ver tus repos:
   dale **Configure GitHub App** y autoriza `gamificacion-ampi`
4. Selecciona el repositorio

Railway va a intentar construir de inmediato. **Ese primer intento va a
fallar** porque todavía no hay base de datos. Es normal, sigue adelante.

---

## Paso 7. Agregar PostgreSQL

1. Dentro del proyecto: **New → Database → Add PostgreSQL**
2. Espera a que el bloque de Postgres quede en verde

Railway conecta la base sola e inyecta la variable `DATABASE_URL` en tu
aplicación. **No tienes que copiarla ni escribirla en ningún lado.**

**Verificación** — clic en el servicio de la aplicación → pestaña
**Variables**. Debe aparecer `DATABASE_URL` con una liga a Postgres.

---

## Paso 8. Configurar las variables de entorno

En el servicio de la aplicación → **Variables → New Variable**. Agrega
estas cuatro, una por una:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | (ver abajo) |
| `ADMIN_PASSWORD` | una contraseña fuerte tuya |
| `STAFF_PASSWORD` | otra contraseña, para el personal del stand |

Para generar el `SESSION_SECRET`, corre esto en tu terminal y pega el
resultado:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Anota `ADMIN_PASSWORD` y `STAFF_PASSWORD` en un lugar seguro.** Con la
> primera entras tú al panel; la segunda es la que le das al personal de
> la estación de registro.

Railway redesplegará solo al guardar las variables. Espera a que el
despliegue quede en verde.

---

## Paso 9. Preparar la base de datos

En el servicio de la aplicación, abre la terminal de Railway:
**menú de tres puntos (⋯) → Terminal**. Ahí ejecuta:

```bash
npm run migrate
```

Debe imprimir `001_schema.sql … ok`, `002_marca.sql … ok` y
`Migración completa.`

Luego:

```bash
npm run seed
```

Esto crea los 40 módulos, las 4 rifas y los dos usuarios.

> **Estos dos comandos se corren UNA SOLA VEZ.** Volver a correr `seed`
> duplicaría los 40 módulos.

**Verificación** — el `seed` imprime las credenciales y los primeros
cinco módulos con su PIN.

---

## Paso 10. Guardar las credenciales de los módulos

El `seed` genera un archivo `credenciales.csv` con el PIN y la liga de
los 40 módulos. **Es lo que le vas a repartir a cada expositor**, así que
no lo pierdas. Todavía en la terminal de Railway:

```bash
cat credenciales.csv
```

Copia todo el contenido y pégalo en un archivo en tu computadora.

> Los PIN están hasheados en la base: **no se pueden volver a consultar**.
> Si pierdes el archivo, tendrías que generar PIN nuevos uno por uno desde
> el panel.

---

## Paso 11. Publicar el dominio

1. Servicio de la aplicación → **Settings → Networking**
2. **Generate Domain**
3. Railway te da una dirección tipo
   `gamificacion-ampi-production.up.railway.app`

**Verificación** — abre en el navegador:

```
https://TU-DOMINIO.up.railway.app/api/salud
```

Debe responder `{"ok":true,"hora":"..."}`. Si responde eso, ya está en línea.

---

# PARTE 3 — Configuración inicial

## Paso 12. Entrar al panel

Abre `https://TU-DOMINIO/admin` e inicia sesión con
`admin@quantummkt.mx` y el `ADMIN_PASSWORD` que definiste.

Revisa que la pestaña **Tablero** cargue con los 40 módulos.

---

## Paso 13. Subir los logotipos

Pestaña **Marca**:

- **Logo del evento** — el de AMPI o el que te dé el cliente. PNG con
  fondo transparente da el mejor resultado.
- **Logo Quantum** — los dos espacios ya funcionan con la versión incluida
  en el sistema. Sólo súbelos si quieres reemplazarlos.

Revisa también los textos de la derecha (nombre de agencia, sede).

---

## Paso 14. Ajustar las rifas

Pestaña **Rifas**. Las cuatro que trae el `seed` son de ejemplo: cambia
premios, valores y horarios por los reales, o bórralas y crea las tuyas.

> **Ojo con la zona horaria.** Railway trabaja en UTC. Verifica que la
> hora mostrada en el panel corresponda a la hora de Tijuana antes del
> evento; si no coincide, avísame y lo ajustamos.

---

## Paso 15. Revisar las reglas del juego

Pestaña **Ajustes**. Confirma con el cliente estas cuatro:

| Regla | Recomendado | Qué significa |
|---|---|---|
| Puntos por boleto | `1` | Cada módulo visitado = un boleto |
| Módulos mínimos | `0` | Sin mínimo para participar |
| Excluir ganadores | `si` | Quien ya ganó no vuelve a ganar |
| Sólo verificados | `si` | Sólo participa quien dejó su teléfono |

---

## Paso 16. Imprimir los instructivos

Pestaña **Módulos**. En cada fila hay un botón **Instructivo** que abre
la hoja lista para imprimir con el nombre y la liga de ese módulo.

Para que el PIN salga impreso, primero dale **Nuevo PIN** y luego
**Instructivo** en esa misma sesión del navegador.

---

# PARTE 4 — Pruebas antes del evento

Hazlas **desde un celular real**, no desde la computadora.

## Prueba 1 — El escáner

1. Abre en el celular `https://TU-DOMINIO/s/<token-de-un-módulo>`
2. Escribe el PIN
3. Acepta el permiso de cámara
4. Desde otro dispositivo abre `/registro`, regístrate y muestra tu QR
5. Escanéalo

Debe ponerse **verde** con tu nombre, sonar y vibrar.

## Prueba 2 — El duplicado

Escanea el mismo código otra vez. Debe ponerse **ámbar** diciendo que esa
persona ya visitó el módulo.

## Prueba 3 — Sin internet (la más importante)

1. Con el escáner abierto, pon el celular en **modo avión**
2. Escanea dos o tres códigos: deben decir "Guardado, se enviará al
   recuperar señal"
3. Quita el modo avión
4. En unos segundos el aviso desaparece

Verifica en `/admin` → Tablero que los escaneos hayan llegado.

## Prueba 4 — El sorteo

En `/admin` → Rifas, crea una rifa de prueba y dale **Sortear ahora**.
Ten `/pantalla` abierta en otra ventana: debe correr la animación y
revelar al ganador.

Al terminar, borra esa rifa de prueba.

## Prueba 5 — Recuperar sesión

En el celular donde te registraste, borra los datos del navegador. Entra
a `/registro` → **Ya me registré** y usa tu teléfono más tu código de 6
caracteres. Debe devolverte a tu panel con tus puntos.

---

# Actualizar el sistema después

Cuando yo te pase cambios, sólo tienes que hacer esto:

```bash
cd ~/Downloads/gamificacion-ampi
git add .
git commit -m "Descripción del cambio"
git push
```

Railway detecta el push y redespliega solo. **No vuelvas a correr `seed`.**

---

# Si algo sale mal

| Problema | Qué revisar |
|---|---|
| El despliegue falla | Railway → pestaña **Deployments** → clic en el fallido → lee el log. Casi siempre es una variable de entorno faltante. |
| `/api/salud` da error 503 | La base no está conectada. Revisa que `DATABASE_URL` exista en Variables. |
| El panel no deja entrar | ¿Corriste `npm run seed`? Sin eso no existe el usuario admin. |
| La cámara no abre | Debe ser **https**. El dominio de Railway ya lo es; en local no funciona salvo en `localhost`. |
| Perdí el `credenciales.csv` | Genera PIN nuevos desde **Módulos → Nuevo PIN**, uno por uno. |
| Las horas de las rifas están corridas | Es zona horaria (Railway usa UTC). Avísame. |

---

# Resumen para el día del evento

**La noche anterior**

- Verifica que `/api/salud` responda
- Confirma horarios y premios en **Rifas**
- Imprime los instructivos de los 40 módulos
- Ten a la mano un hotspot 4G de respaldo para la computadora del proyector

**En la mañana**

- Abre `/pantalla` en el proyector, a pantalla completa
- Abre `/estacion` en las tablets de la entrada, con la cuenta de staff
- Reparte a cada expositor su instructivo y verifica que su escáner abra
- Deja `/admin` abierto en tu laptop

**Durante**

- Vigila el contador **Sin identificar** en el tablero: si crece mucho,
  refuerza la estación de registro
- Las rifas se sortean solas a su hora; **Sortear ahora** es sólo por si
  necesitas adelantar alguna

**Al cerrar**

- **Ganadores** para el listado con teléfonos y marcar entregas
- Exporta los tres CSV: asistentes, ganadores y escaneos
