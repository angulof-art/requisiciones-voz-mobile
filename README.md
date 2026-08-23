# Pedidos por Voz

Aplicacion web movil para crear pedidos o requisiciones por voz.

Version actual: **2.0.0-beta.2**. La estrategia completa de evolucion y
migracion segura esta en `V2_IMPLEMENTATION_PLAN.md`.

## Funciones incluidas

- Responsable obligatorio antes de confirmar o exportar.
- Reconocimiento de voz en espanol de Costa Rica con sesiones continuas de hasta
  45 segundos para dictar varios productos y tolerar pausas naturales.
- Cada dictado se interpreta y agrega directamente al pedido, sin un paso de aceptacion.
- Parser de productos, cantidades, unidades y observaciones.
- Pantalla unica mobile-first con boton de voz compacto y lineas editables.
- Agregar, eliminar, duplicar, redictar, combinar duplicados y deshacer.
- Boton `Nuevo pedido` que conserva el pedido anterior como borrador antes de
  iniciar una requisicion limpia.
- Guardado automatico en IndexedDB y sincronizacion bidireccional con Supabase.
- Migracion V10 idempotente que conserva intacto el respaldo `localStorage`.
- Estados reales de guardado, fallback controlado y cola con backoff.
- Confirmar, exportar y anular sin borrar historial.
- Numeracion diaria tipo `REQ-20260803-0001`.
- Historial combinado local/Supabase con busqueda, filtros, resumen de productos,
  duplicado y reapertura de borradores.
- Catalogo importable por CSV.
- Catalogo maestro inicial de 327 productos habituales del restaurante, sin
  nombres ni codigos duplicados y con sinonimos para reconocimiento de voz.
- Exportacion PDF imprimible y Excel `.xlsx` con `Producto`, `Cantidad` y
  `Unidad de compra`.
- CSV compatible con Google Sheets disponible desde el modulo de exportacion.
- PWA offline con indicador de conexion y cola de sincronizacion.
- Aviso de nueva version, actualizacion controlada e instalacion cuando el
  navegador ofrece PWA instalable.
- Migracion SQL para Supabase.

## Ejecucion local

Sirve la carpeta con cualquier servidor estatico.

```powershell
pnpm run serve
```

Luego abre:

```text
http://127.0.0.1:4177
```

Tambien puede abrirse `index.html`, pero el service worker y el microfono
funcionan mejor sobre `http://127.0.0.1`.

## Pruebas

```powershell
pnpm run lint
pnpm test
pnpm run build
```

La version de `package.json` es la fuente de verdad. Despues de cambiarla:

```powershell
pnpm run version:sync
```

`test` y `build` fallan si HTML, manifest o imports conservan otra version.

## Catalogo

La plantilla esta en `data/plantilla-catalogo.csv`. En la app entra a
`Catalogo`, presiona `Importar catalogo` y selecciona un CSV con columnas:

```text
code,official_name,category,default_unit,allowed_units,synonyms,active
```

El catalogo maestro listo para importar esta en
`data/catalogo-productos-maestro.csv`. Incluye frutas y vegetales, proteinas,
refrigerados, congelados y abarrotes. La fuente JavaScript utilizada por la app
se genera en `src/catalog-data.js`, y la carga equivalente para Supabase esta
en `supabase/migrations/202608040003_seed_master_catalog.sql`.

Para regenerarlo desde dos archivos tabulados con la misma estructura de las
fuentes originales:

```powershell
node tools/generate-master-catalog.mjs frutas.tsv restaurante.tsv
```

Con la URL y la publishable key configuradas en `src/config.js`, el catalogo se
puede volver a sincronizar de forma idempotente con:

```powershell
pnpm run catalog:sync
```

## Supabase

1. Ejecuta `supabase/migrations/202608030001_requisitions.sql`.
2. Para una prueba funcional sin login, ejecuta tambien
   `supabase/migrations/202608030002_dev_anon_requisitions.sql`.
3. La version publicada incluye la URL y la publishable key publica del proyecto
   de demostracion en `src/config.js`.
4. No uses `service_role`, `sb_secret_` ni credenciales privadas.
5. Para produccion, configura Supabase Auth y retira la migracion `dev_anon`.
   Esa segunda migracion es para demo/piloto, no para datos sensibles.

La pantalla **Configuracion** permite activar o desactivar la nube y controlar
la sincronizacion automatica. Sus acciones manuales son deliberadamente
separadas:

- **Probar** verifica la conexion sin mover pedidos.
- **Subir local** envia el catalogo y los pedidos guardados en el dispositivo.
- **Descargar nube** combina el historial remoto con el local sin borrar datos
  del dispositivo.

El codigo de operacion funciona como espacio de trabajo. Los dispositivos que
deban compartir pedidos tienen que usar exactamente el mismo codigo.

## Despliegue

Puede publicarse como sitio estatico en GitHub Pages, Netlify, Vercel, Supabase
Hosting o cualquier servidor que entregue HTML/CSS/JS.

Sube todo el contenido de esta carpeta y asegúrate de que `index.html`,
`src/`, `data/`, `manifest.webmanifest` y `service-worker.js` queden en la misma
raiz publica.

## Version 2 recomendada

- Supabase Auth completo.
- Google Sheets API con OAuth.
- Aprobaciones por rol.
- Envio por correo o WhatsApp luego de confirmacion manual.
- Importacion XLSX nativa.
- Firma digital del receptor.

## Seguridad del piloto

La sincronizacion publicada todavia utiliza la migracion anon de demostracion.
No debe usarse con datos reales de varias organizaciones. Supabase Auth, el
backfill de los datos V10 y el retiro coordinado de esas politicas corresponden
a la Fase 3 documentada en `V2_IMPLEMENTATION_PLAN.md`.
