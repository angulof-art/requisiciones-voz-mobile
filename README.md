# Pedidos por Voz

Aplicacion web movil para crear pedidos o requisiciones por voz.

## Funciones incluidas

- Responsable obligatorio antes de guardar, confirmar o exportar.
- Reconocimiento de voz en espanol de Costa Rica cuando el navegador lo soporte.
- Transcripcion visible.
- Parser de productos, cantidades, unidades y observaciones.
- Tarjetas editables mobile-first.
- Agregar, eliminar, duplicar, reordenar, combinar duplicados y deshacer.
- Guardar borrador, confirmar, exportar y anular sin borrar historial.
- Numeracion diaria tipo `REQ-20260803-0001`.
- Historial con busqueda, filtros, duplicado y reapertura de borradores.
- Catalogo importable por CSV.
- Exportacion PDF imprimible y Excel `.xlsx` con columnas estilo inventario.
- CSV compatible con Google Sheets disponible desde el modulo de exportacion.
- PWA offline con indicador de conexion y cola de sincronizacion.
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

## Catalogo

La plantilla esta en `data/plantilla-catalogo.csv`. En la app entra a
`Catalogo`, presiona `Importar catalogo` y selecciona un CSV con columnas:

```text
code,official_name,category,default_unit,allowed_units,synonyms,active
```

## Supabase

1. Ejecuta `supabase/migrations/202608030001_requisitions.sql`.
2. Para una prueba funcional sin login, ejecuta tambien
   `supabase/migrations/202608030002_dev_anon_requisitions.sql`.
3. Usa solo la URL del proyecto y una publishable key.
4. No uses `service_role`, `sb_secret_` ni credenciales privadas.
5. Para produccion, configura Supabase Auth y retira la migracion `dev_anon`.
   Esa segunda migracion es para demo/piloto, no para datos sensibles.

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
