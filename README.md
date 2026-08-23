# Pedidos por Voz

Aplicacion web movil para crear pedidos o requisiciones por voz.

Version actual: **2.0.0-beta.3**. La estrategia completa de evolucion y
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
- Inicio de sesion por correo y contraseña con restauracion segura de sesion.
- Organizaciones, sedes, departamentos y permisos por rol protegidos con RLS.
- Perfil operativo y aislamiento local por usuario/organizacion.
- Flujo Cocina a Bodega con prioridad, fecha requerida, entregas parciales,
  faltantes, sustituciones, aceptacion y cierre auditado.
- Voice Engine V2 con fracciones, contexto, comandos y 177 frases controladas.
- Dashboard operativo para manager/administrator y paginacion del historial.
- Deteccion de conflictos por revision para evitar sobrescrituras silenciosas.
- CSP, escaneo de secretos y suite de preparacion para produccion.
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

1. Aplica las migraciones de `supabase/migrations` en orden.
2. Crea el primer administrador siguiendo `docs/ADMIN_BOOTSTRAP.md`.
3. La URL y publishable key publica estan en `src/config.js`.
4. No uses `service_role`, `sb_secret_` ni credenciales privadas en frontend.
5. Ejecuta la matriz de `docs/AUTH_AND_RLS.md` antes de aplicar
   `202608220008_disable_demo_anon_access.sql`.

La pantalla **Configuracion** permite activar o desactivar la nube y controlar
la sincronizacion automatica. Sus acciones manuales son deliberadamente
separadas:

- **Probar** verifica la conexion sin mover pedidos.
- **Subir local** envia el catalogo y los pedidos guardados en el dispositivo.
- **Descargar nube** combina el historial remoto con el local sin borrar datos
  del dispositivo.

`workspace_id` se conserva solo por compatibilidad V10. La autorizacion usa
organizacion, sede, departamento, membresias y roles.

El estado de preparacion real esta en `docs/PRODUCTION_CHECKLIST.md`. La version
`2.0.0-beta.3` no debe promoverse a produccion hasta crear el administrador,
ejecutar la matriz RLS multicuenta y retirar el acceso anonimo de demostracion.

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

## Seguridad y recuperacion

El modelo y el backfill se documentan en `docs/V10_REMOTE_MIGRATION.md`. Las
politicas, matriz y aislamiento estan en `docs/AUTH_AND_RLS.md`. El acceso anon
solo debe retirarse despues de probar usuarios reales; el rollback temporal se
describe en `docs/AUTH_ROLLBACK.md`.

La persistencia, conflictos y recuperacion offline se documentan en
`docs/OFFLINE_AND_SYNC.md`. El informe consolidado de V2 esta en
`V2_FINAL_IMPLEMENTATION_REPORT.md`.
