# Arquitectura

## Decision principal

La aplicacion es una PWA estatica independiente. Mantiene el patron sano de la
app de inventario: archivos simples, service worker que no intercepta recursos
externos, pruebas con Node y migraciones SQL separadas.

## Modulos

- `src/parser.js`: convierte dictado en lineas estructuradas.
- `src/catalog.js`: catalogo maestro, unidades y coincidencias.
- `src/requisitions.js`: pedidos, validaciones, numeracion y cambios.
- `src/storage.js`: persistencia local y cola de sincronizacion.
- `src/exporters.js`: PDF imprimible, Excel `.xlsx` y CSV compatible con Google Sheets.
- `src/config.js`: configuracion publica del proyecto Supabase del piloto.
- `src/supabase.js`: REST seguro con publishable key, sin secretos.
- `src/app.js`: UI, voz, edicion, historial, catalogo y configuracion.

## Datos

La fuente local permite uso sin conexion. La configuracion publica incluida
conecta el piloto a Supabase y la cola se sincroniza automaticamente cuando
regresa la conexion.

## Supuestos

- La primera version exporta Excel `.xlsx` real para Excel y conserva CSV para Google Sheets.
- El PDF se genera como vista imprimible del navegador.
- La integracion directa con Google Sheets queda para una version con OAuth.
- Las ordenes avanzadas de voz se detectan, pero no modifican datos sin revision.
