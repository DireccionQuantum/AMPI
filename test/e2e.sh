#!/bin/bash
# Prueba end-to-end por HTTP contra el servidor corriendo.
set -u
BASE="http://localhost:3000"
OK=0; FAIL=0
J=/tmp/ck_admin.txt; JE=/tmp/ck_expo.txt
rm -f $J $JE

chk(){ if [ "$2" = "1" ]; then OK=$((OK+1)); echo "  ok    $1"; 
       else FAIL=$((FAIL+1)); echo "  FALLA $1 ${3:-}"; fi }
sec(){ echo ""; echo "=== $1 ==="; }

sec "Páginas públicas"
for p in / /registro /mi /scan /admin /pantalla /estacion; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")
  chk "GET $p responde 200" "$([ "$code" = 200 ] && echo 1 || echo 0)" "(HTTP $code)"
done
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/css/base.css")
chk "hoja de estilos disponible" "$([ "$code" = 200 ] && echo 1 || echo 0)"

sec "Seguridad: acceso sin sesión"
for r in /api/admin/tablero /api/admin/rifas /api/admin/asistentes /api/admin/config; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$r")
  chk "$r bloqueado sin sesión" "$([ "$code" = 403 ] && echo 1 || echo 0)" "(HTTP $code)"
done
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/scan" \
       -H 'Content-Type: application/json' -d '{"qr":"aaaaaaaaaaaaaaaaaaaaaaaa"}')
chk "escaneo bloqueado sin sesión de expositor" "$([ "$code" = 403 ] && echo 1 || echo 0)" "(HTTP $code)"

sec "Login de administrador"
r=$(curl -s -c $J -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
     -d '{"email":"admin@quantummkt.mx","password":"ampi2026"}')
chk "login correcto" "$(echo "$r" | grep -q '"ok":true' && echo 1 || echo 0)"
r=$(curl -s -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
     -d '{"email":"admin@quantummkt.mx","password":"incorrecta"}')
chk "contraseña incorrecta se rechaza" "$(echo "$r" | grep -q 'incorrectos' && echo 1 || echo 0)"
r=$(curl -s -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' \
     -d '{"email":"noexiste@x.com","password":"x"}')
chk "correo inexistente da el mismo mensaje" "$(echo "$r" | grep -q 'incorrectos' && echo 1 || echo 0)"

sec "Tablero"
r=$(curl -s -b $J "$BASE/api/admin/tablero")
chk "tablero carga con sesión" "$(echo "$r" | grep -q '"metricas"' && echo 1 || echo 0)"
chk "incluye ranking y rifas" "$(echo "$r" | grep -q '"ranking"' && echo "$r" | grep -q '"rifas"' && echo 1 || echo 0)"

sec "Registro de asistente"
TEL="664$(shuf -i 1000000-9999999 -n1)"
r=$(curl -s -X POST "$BASE/api/asistente/registro" -H 'Content-Type: application/json' \
     -d "{\"nombre\":\"Prueba\",\"apellido\":\"Integración\",\"telefono\":\"$TEL\"}")
QR=$(echo "$r" | grep -o '"qr_id":"[^"]*' | cut -d'"' -f4)
TOKEN=$(echo "$r" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
CODIGO=$(echo "$r" | grep -o '"codigo":"[^"]*' | cut -d'"' -f4)
chk "registro devuelve qr_id de 24 hex" "$(echo "$QR" | grep -qE '^[a-f0-9]{24}$' && echo 1 || echo 0)"
chk "registro devuelve token de 32 hex" "$(echo "$TOKEN" | grep -qE '^[a-f0-9]{32}$' && echo 1 || echo 0)"
chk "registro devuelve código de 6 caracteres" "$(echo "$CODIGO" | grep -qE '^[A-Z0-9]{6}$' && echo 1 || echo 0)"

r=$(curl -s -X POST "$BASE/api/asistente/registro" -H 'Content-Type: application/json' \
     -d '{"nombre":"X","telefono":"123"}')
chk "datos inválidos devuelven errores por campo" "$(echo "$r" | grep -q '"errores"' && echo 1 || echo 0)"

# Un desconocido NO debe poder apropiarse de una cuenta ajena sabiendo el teléfono.
code=$(curl -s -o /tmp/dup.json -w '%{http_code}' -X POST "$BASE/api/asistente/registro" \
       -H 'Content-Type: application/json' \
       -d "{\"nombre\":\"Intruso\",\"apellido\":\"Ajeno\",\"telefono\":\"$TEL\"}")
chk "teléfono ajeno se rechaza en registro público" "$([ "$code" = 409 ] && echo 1 || echo 0)" "(HTTP $code)"
chk "no entrega token de la cuenta ajena" "$(grep -q '"token"' /tmp/dup.json && echo 0 || echo 1)"

# El staff autenticado sí puede reemitir el acceso.
code=$(curl -s -o /tmp/dup2.json -w '%{http_code}' -b $J -X POST "$BASE/api/asistente/registro" \
       -H 'Content-Type: application/json' \
       -d "{\"nombre\":\"Prueba\",\"apellido\":\"Integracion\",\"telefono\":\"$TEL\"}")
chk "staff sí puede reemitir acceso" "$([ "$code" = 200 ] && echo 1 || echo 0)" "(HTTP $code)"
chk "staff recibe la misma cuenta" "$(grep -q "\"qr_id\":\"$QR\"" /tmp/dup2.json && echo 1 || echo 0)"
# El reemitir rota credenciales: usamos las nuevas de aquí en adelante.
TOKEN=$(grep -o '"token":"[^"]*' /tmp/dup2.json | cut -d'"' -f4)
CODIGO=$(grep -o '"codigo":"[^"]*' /tmp/dup2.json | cut -d'"' -f4)

sec "Panel del asistente"
r=$(curl -s "$BASE/api/asistente/panel/$QR")
chk "panel responde" "$(echo "$r" | grep -q '"progreso"' && echo 1 || echo 0)"
chk "lista los 40 módulos" "$(echo "$r" | grep -q '"total":40' && echo 1 || echo 0)"
chk "no expone el teléfono completo" "$(echo "$r" | grep -q "\"telefono\":\"$TEL\"" && echo 0 || echo 1)"
r=$(curl -s "$BASE/api/asistente/sesion/$TOKEN")
chk "sesión se restaura por token" "$(echo "$r" | grep -q "\"qr_id\":\"$QR\"" && echo 1 || echo 0)" "(token=$TOKEN)"

sec "Escáner del expositor"
TOKEXPO=$(su postgres -c "psql -d ampi_test -tAc 'SELECT token FROM expositores ORDER BY id LIMIT 1'")
EXPOID=$(su postgres -c "psql -d ampi_test -tAc 'SELECT id FROM expositores ORDER BY id LIMIT 1'")
# Reasignamos un PIN conocido para la prueba
NEWPIN=$(curl -s -b $J -X POST "$BASE/api/admin/expositores/$EXPOID/pin" | grep -o '"pin":"[^"]*' | cut -d'"' -f4)
chk "admin puede regenerar el PIN" "$(echo "$NEWPIN" | grep -qE '^[0-9]{4}$' && echo 1 || echo 0)"

r=$(curl -s -c $JE -X POST "$BASE/api/scan/login" -H 'Content-Type: application/json' \
     -d "{\"token\":\"$TOKEXPO\",\"pin\":\"$NEWPIN\"}")
chk "expositor entra con token + PIN" "$(echo "$r" | grep -q '"ok":true' && echo 1 || echo 0)"
r=$(curl -s -X POST "$BASE/api/scan/login" -H 'Content-Type: application/json' \
     -d "{\"token\":\"$TOKEXPO\",\"pin\":\"0000\"}")
chk "PIN incorrecto se rechaza" "$(echo "$r" | grep -q 'PIN incorrecto' && echo 1 || echo 0)"

sec "Escaneo"
r=$(curl -s -b $JE -X POST "$BASE/api/scan" -H 'Content-Type: application/json' \
     -d "{\"qr\":\"$QR\"}")
chk "primer escaneo se registra" "$(echo "$r" | grep -q '"resultado":"ok"' && echo 1 || echo 0)"
chk "responde con nombre del asistente" "$(echo "$r" | grep -q 'Prueba' && echo 1 || echo 0)"
r=$(curl -s -b $JE -X POST "$BASE/api/scan" -H 'Content-Type: application/json' \
     -d "{\"qr\":\"$QR\"}")
chk "segundo escaneo del mismo módulo es duplicado" \
    "$(echo "$r" | grep -q '"resultado":"duplicado"' && echo 1 || echo 0)"

r=$(curl -s -b $JE -X POST "$BASE/api/scan" -H 'Content-Type: application/json' \
     -d '{"qr":"no-es-un-codigo"}')
chk "código inválido se rechaza" "$(echo "$r" | grep -q '"resultado":"invalido"' && echo 1 || echo 0)"

# QR desconocido: plan B
FANTASMA=$(openssl rand -hex 12)
r=$(curl -s -b $JE -X POST "$BASE/api/scan" -H 'Content-Type: application/json' \
     -d "{\"qr\":\"$FANTASMA\"}")
chk "QR desconocido igual suma el punto" "$(echo "$r" | grep -q '"resultado":"ok"' && echo 1 || echo 0)"
chk "avisa que requiere datos" "$(echo "$r" | grep -q '"requiereDatos":true' && echo 1 || echo 0)"

r=$(curl -s -b $JE "$BASE/api/scan/resumen")
chk "resumen del módulo responde" "$(echo "$r" | grep -q '"visitas"' && echo 1 || echo 0)"

sec "Recuperación de sesión"
# El endpoint tiene rate limit de 10/15min por IP: entre corridas seguidas
# del script puede agotarse, así que 429 se reporta aparte y no cuenta como falla.
code=$(curl -s -o /tmp/rec.json -w '%{http_code}' -X POST "$BASE/api/asistente/recuperar" \
       -H 'Content-Type: application/json' -d "{\"telefono\":\"$TEL\",\"codigo\":\"$CODIGO\"}")
if [ "$code" = "429" ]; then
  echo "  --    recupera con teléfono + código (omitida: rate limit activo)"
else
  chk "recupera con teléfono + código" \
      "$(grep -q '"ok":true' /tmp/rec.json && echo 1 || echo 0)" "(HTTP $code)"
fi
code=$(curl -s -o /tmp/rec2.json -w '%{http_code}' -X POST "$BASE/api/asistente/recuperar" \
       -H 'Content-Type: application/json' -d "{\"telefono\":\"$TEL\",\"codigo\":\"XXXXXX\"}")
chk "código equivocado se rechaza" "$([ "$code" = 401 ] || [ "$code" = 429 ] && echo 1 || echo 0)" "(HTTP $code)"

sec "Rifas y sorteo"
HORA=$(date -u -d '+2 minutes' '+%Y-%m-%dT%H:%M:00Z')
r=$(curl -s -b $J -X POST "$BASE/api/admin/rifas" -H 'Content-Type: application/json' \
     -d "{\"premio\":\"Premio de prueba\",\"valor\":1500,\"hora\":\"$HORA\",\"num_ganadores\":1}")
RIFA=$(echo "$r" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
chk "se crea una rifa" "$(echo "$r" | grep -q '"ok":true' && echo 1 || echo 0)"

r=$(curl -s -b $J "$BASE/api/admin/rifas/$RIFA/previa")
chk "previa cuenta participantes" "$(echo "$r" | grep -q '"personas"' && echo 1 || echo 0)"

r=$(curl -s -b $J -X POST "$BASE/api/admin/rifas/$RIFA/sortear")
chk "sorteo manual funciona" "$(echo "$r" | grep -q '"ok":true' && echo 1 || echo 0)"
r=$(curl -s -b $J -X POST "$BASE/api/admin/rifas/$RIFA/sortear")
chk "no se puede sortear dos veces" "$(echo "$r" | grep -q 'ya se sorteó' && echo 1 || echo 0)"

r=$(curl -s -b $J "$BASE/api/admin/ganadores")
chk "lista de ganadores incluye teléfono" "$(echo "$r" | grep -q '"telefono"' && echo 1 || echo 0)"

sec "Exportación CSV"
r=$(curl -s -b $J "$BASE/api/admin/export/asistentes" | head -1)
chk "CSV de asistentes con encabezados" "$(echo "$r" | grep -q 'nombre' && echo 1 || echo 0)"
code=$(curl -s -o /dev/null -w '%{http_code}' -b $J "$BASE/api/admin/export/inexistente")
chk "exportación inválida da 404" "$([ "$code" = 404 ] && echo 1 || echo 0)"

sec "Validación de entradas"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/asistente/panel/xx")
chk "qr_id malformado da 400" "$([ "$code" = 400 ] && echo 1 || echo 0)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/asistente/sesion/zzz")
chk "token malformado da 404" "$([ "$code" = 404 ] && echo 1 || echo 0)"
code=$(curl -s -o /tmp/rif.json -w '%{http_code}' -b $J -X POST "$BASE/api/admin/rifas" \
       -H 'Content-Type: application/json' -d '{"premio":"Prueba","hora":"no-es-fecha"}')
chk "fecha inválida se rechaza" "$([ "$code" = 422 ] && echo 1 || echo 0)" "(HTTP $code)"

echo ""
echo "========================================"
echo "  $OK pruebas pasaron, $FAIL fallaron"
echo "========================================"
[ "$FAIL" -eq 0 ]
