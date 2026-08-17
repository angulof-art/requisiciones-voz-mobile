# Arquitectura

## Decision principal

La aplicacion es una PWA estatica independiente. Mantiene el patron sano de la
app de inventario: archivos simples, service worker que no intercepta recursos
externos, pruebas con Node y migraciones SQL separadas.

## Modulos

- `src/parser.js`: convierte dictado en lineas estructuradas.
- `src/catalog.js`: catalogo maestro, unidades y coincidencias.
- `src/requisitions.js`: pedidos, validaciones, numeracion, cambios y combinacion
  segura del historial local/remoto.
- `src/storage.js`: persistencia local y cola de sincronizacion.
- `src/exporters.js`: PDF imprimible, Excel `.xlsx` y CSV compatible con Google Sheets.
- `src/config.js`: configuracion publica del proyecto Supabase del piloto.
- `src/supabase.js`: REST seguro con publishable key, sin secretos, con carga y
  descarga del historial.
- `src/app.js`: UI, voz, edicion, historial, catalogo y configuracion.

## Datos

La fuente local permite uso sin conexion. La configuracion publica incluida
conecta el piloto a Supabase. La cola sube cambios automaticamente cuando
regresa la conexion y la aplicacion descarga y combina los pedidos remotos sin
sobrescribir borradores locales mas recientes.

La sincronizacion se puede desactivar por dispositivo. La interfaz expone
operaciones independientes para probar la conexion, subir el estado local y
descargar el estado remoto; la descarga reutiliza la misma combinacion segura
del historial y nunca vacia la base local antes de incorporar la nube.

## Supuestos

- La primera version exporta Excel `.xlsx` real para Excel y conserva CSV para Google Sheets.
- El PDF se genera como vista imprimible del navegador.
- La integracion directa con Google Sheets queda para una version con OAuth.
- Las ordenes avanzadas de voz se detectan, pero no modifican datos sin revision.
