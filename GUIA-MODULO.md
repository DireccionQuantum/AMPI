# Operación del módulo Quantum — AMPI Tijuana 2026

Guía de la parte que opera Quantum: la base previa, las etiquetas y la
entrega de carnets en el stand. Para el despliegue del sistema completo,
ver `GUIA-DESPLIEGUE.md`.

---

## Resumen del flujo

| Cuándo | Qué se hace | Dónde |
|---|---|---|
| Al recibir la lista | Importar la base previa | `/admin` → pestaña **Módulo** |
| Hasta un día antes | Imprimir etiquetas por lote | `/etiquetas` |
| Día del evento | Entregar carnets y marcar entrega | `/entrega` |
| Día del evento | Alta de quien no venía en la lista | `/estacion` |

---

## 1. Importar la base previa

Entra a `/admin` con la cuenta de administrador, pestaña **Módulo**.

Arrastra el archivo que te mandó AMPI o pega su contenido. Al presionar
**Revisar archivo** se muestra qué va a pasar **sin guardar nada**: cuántos
son nuevos, cuántos ya existían y qué filas no sirven, con su número de
línea y el motivo. Sólo al presionar **Confirmar importación** se escribe
en la base.

### Qué columnas reconoce

No importa el orden ni las mayúsculas ni los acentos. Se aceptan estos
nombres de columna, entre otros:

- **Nombre**: nombre, nombres, nombre completo
- **Apellido**: apellido, apellidos, apellido paterno
- **Teléfono**: telefono, tel, celular, móvil, whatsapp
- **Correo**: email, correo, correo electrónico
- **Empresa**: empresa, compañía, organización, inmobiliaria
- **Identificador**: id, qr, objectid, folio, código

Separadores aceptados: coma, punto y coma o tabulador. Si el nombre viene
completo en una sola columna, se parte solo.

### Lo que hay que saber

- **Reimportar no duplica.** Cuando llegue la lista actualizada, se puede
  importar completa. Reconoce a quien ya está y sólo agrega a los nuevos.
- **No pisa lo capturado en el stand.** Si alguien ya se registró en vivo y
  después llega su fila en el archivo, se rellenan los campos vacíos pero no
  se sobrescribe lo que la persona dijo en el módulo.
- **Si el archivo trae el identificador de WeChamber**, se respeta. Si no lo
  trae, el sistema emite uno propio con el mismo formato. El escáner del
  expositor no nota la diferencia.
- Una fila mala no aborta la importación: se reporta y el resto entra.

---

## 2. Imprimir las etiquetas

Entra a `/etiquetas` (o desde la pestaña **Módulo**).

1. Deja el filtro en **Sólo pendientes de imprimir**.
2. Espera a que todos los códigos QR aparezcan. El botón **Imprimir lote**
   se habilita hasta entonces, a propósito: imprimir antes saca etiquetas
   con el cuadro en blanco.
3. Presiona **Imprimir lote**. En el diálogo del sistema, confirma que el
   tamaño de papel sea **62 × 50 mm**.
4. Al terminar, el sistema pregunta si salieron bien. **Sólo confirma si de
   verdad se imprimieron**: al aceptar dejan de aparecer como pendientes.

Si la impresora se atora a la mitad, no confirmes. Vuelve a cargar la
página y el lote sigue completo en pendientes.

### Impresora

Brother QL-800, rollo **DK-2205 de 62 mm**. Conectada por USB a la
computadora donde se imprime. El logo se imprime en negro puro, que es lo
que entiende una impresora térmica.

---

## 3. La mesa de entrega

Es la pantalla que usan los practicantes: `/entrega`. Requiere sesión de
staff o de administrador; conviene dejarla abierta en cada dispositivo
antes de que empiece a llegar gente.

**Cómo se usa:**

1. El asistente da su apellido.
2. Se teclean dos o tres letras. No hace falta poner acentos ni mayúsculas:
   escribir `rios` encuentra a *Ríos*, `torre` encuentra a *de la Torre*.
   También busca por empresa y por código de respaldo.
3. Se le entrega su carnet con la etiqueta pegada y se presiona
   **Entregar**. La tarjeta se pone verde.
4. Si alguien **no aparece**, aparece el botón **Registrar aquí**, que lleva
   a la estación de alta con lo ya tecleado. Ahí se le da de alta en vivo y
   se le imprime su etiqueta en el momento.

Cada tarjeta muestra si su etiqueta ya está impresa o falta, y el botón
**Imprimir** saca la etiqueta individual de esa persona.

Arriba se ve, en vivo, cuántos van entregados, cuántos faltan y cuántas
altas se hicieron en el evento.

**Si se marca una entrega por error**, el botón **Deshacer** la revierte.

---

## 4. Recomendaciones de operación

- **Ordena físicamente los carnets impresos por apellido** antes del evento.
  El sistema los imprime en ese orden justamente para eso.
- **Tres dispositivos** en la mesa de entrega, cada uno con su sesión ya
  iniciada. Todos comparten la misma lista y ven las entregas de los demás.
- **Deja la impresora prendida** durante el evento, aunque hayas
  preimpreso todo: es para quien no venía en la lista.
- **Prueba la impresión de una etiqueta real y escanéala** con el escáner
  del expositor antes del día del evento. Es la única forma de saber que el
  QR impreso se lee bien a 22 mm.
- La zona horaria del servidor debe estar en hora de Tijuana. Verifícalo
  antes de programar las rifas.

---

## 5. Usuarios de los practicantes

`/admin` → pestaña **Usuarios**. Sólo un administrador la ve.

Para cada practicante: nombre, correo, contraseña y rol **staff**. El botón
**Sugerir contraseña** genera una fácil de dictar en voz alta, del estilo
`sierra-mango-92`. Anótala antes de salir de la pantalla: se guarda cifrada
y no se puede volver a ver.

Qué puede hacer cada rol:

| | staff | admin |
|---|---|---|
| Mesa de entrega y estación de registro | sí | sí |
| Imprimir etiquetas | sí | sí |
| Importar la base previa | no | sí |
| Configurar reglas y rifas | no | sí |
| Crear usuarios | no | sí |

**Desactivar en lugar de borrar.** Al terminar el evento, desactiva las
cuentas de los practicantes. Conservan su rastro en la bitácora y dejan de
poder entrar.

El sistema no te deja desactivarte a ti mismo ni quitarte tu propio rol de
administrador, y siempre exige que quede al menos un admin activo.

---

## 6. Comandos de prueba

```bash
npm run simular         # 41 pruebas contra la base
npm run test:import     # 32 pruebas del importador
npm run test:modulo     # 40 pruebas del flujo del módulo (requiere servidor)
npm run test:usuarios   # 28 pruebas de usuarios y permisos (requiere servidor)
npm run test:expositores # 27 pruebas de alta, edición y baja de stands
npm run test:codigo     # 19 pruebas del acceso por código de módulo
bash test/e2e.sh        # 52 pruebas end-to-end (requiere servidor en :3000)
```

Total: **239 pruebas**.

---

## 6-bis. Administrar los stands (expositores) desde el panel

`/admin` → pestaña **Módulos**. Cada fila tiene seis acciones: **Nuevo
PIN**, **Instructivo**, **Desactivar / Reactivar**, **Editar** y
**Eliminar**.

**Agregar módulo** da de alta uno nuevo pidiendo nombre, empresa (opcional)
y los puntos que otorga cada visita. Entrega el PIN y la liga una sola vez
en pantalla: anótalos ahí, porque después sólo viven cifrados.

**Editar** cambia nombre, empresa y puntos de un stand ya existente. No
toca su PIN ni su liga ni su historial.

**Desactivar** no borra nada: el historial de puntos y escaneos se
conserva completo. Lo único que cambia es que el PIN y la liga dejan de
aceptar accesos de inmediato — ni el expositor puede entrar a escanear, ni
alguien con la liga vieja puede usarla. Es lo correcto para un stand que
canceló o llegó tarde.

**Eliminar** borra el stand por completo, pero el sistema sólo lo permite
si nunca recibió una sola visita. Si ya tiene escaneos registrados, el
panel lo rechaza y ofrece desactivarlo en su lugar. Esta protección no se
puede saltar desde la interfaz: existe porque borrar un stand con
historial arrastraría en cascada los puntos que asistentes reales ya
ganaron ahí, sin dejar rastro de qué pasó. Un stand mal dado de alta antes
del evento, en cambio, se puede quitar sin ese riesgo.

## 6-ter. Cómo entra el expositor a su escáner

**Todos los módulos entran a la misma dirección:**

```
https://tu-dominio/scan
```

Ahí escriben el **código de 6 caracteres** de su módulo y listo. No hay
liga distinta por stand ni PIN aparte.

El código se ve en `/admin` → pestaña **Módulos**, en su propia columna, y
sale impreso en el **Instructivo** de cada expositor.

Detalles que conviene saber:

- El código no distingue mayúsculas ni le molestan espacios o guiones.
- No usa 0, O, 1, I ni L, porque se confunden al leer en papel.
- **Nuevo código** genera uno distinto y el anterior deja de servir de
  inmediato. Úsalo si un código se filtró.
- Las ligas `/s/<clave>` que ya hayas repartido **siguen funcionando** y
  ahora entran directo, sin pedir nada más.

**Sobre el límite de intentos:** el corte es por código, no por dirección
de internet. Esto importa porque en el salón los 40 módulos comparten el
mismo WiFi y salen por una sola IP; si el límite fuera por IP, a partir
del módulo quince se bloquearían entre sí. Así, quien se equivoca sólo se
afecta a sí mismo.

## 7. Referencia de la API

Todas requieren sesión. `soloAdmin` para importar, `soloStaff` para el resto.

| Método y ruta | Para qué |
|---|---|
| `POST /api/admin/importar` | Importa. Sin `confirmar:true` sólo simula. |
| `GET /api/admin/modulo/panorama` | Totales de impresión y entrega. |
| `GET /api/admin/modulo/buscar?q=` | Busca en la mesa de entrega. |
| `POST /api/admin/modulo/entregar` | Marca la entrega del carnet. |
| `POST /api/admin/modulo/desentregar` | Revierte una entrega. |
| `GET /api/admin/modulo/etiquetas` | Lista para imprimir. `?filtro=todos` |
| `POST /api/admin/modulo/etiquetas/impresas` | Marca un lote como impreso. |
| `GET /api/admin/modulo/asistente/:id` | Datos para la etiqueta individual. |
| `GET /api/admin/usuarios` | Lista usuarios del panel. Sólo admin. |
| `POST /api/admin/usuarios` | Crea usuario. Sólo admin. |
| `POST /api/admin/usuarios/:id/password` | Cambia contraseña. Sólo admin. |
| `POST /api/admin/usuarios/:id/activo` | Activa o desactiva. Sólo admin. |
| `POST /api/admin/usuarios/:id/rol` | Cambia el rol. Sólo admin. |
