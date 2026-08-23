# Pedidos por Voz V2 - Plan de implementacion

Fecha de auditoria: 22/08/2026  
Version auditada: V10, commit `09424c6`  
Objetivo inicial: estabilizar la base existente antes de migrar almacenamiento,
autenticacion o modelo de datos.

## 1. Estado actual

La aplicacion es una PWA estatica, sin framework ni dependencias de produccion.
El frontend usa modulos ES, Web Speech API, `localStorage`, REST de Supabase y
un service worker network-first. Conserva creacion manual y por voz, catalogo,
historial, duplicado, revision, exportacion PDF, Excel y CSV, offline y
sincronizacion bidireccional.

Linea base ejecutada antes de modificar codigo:

- `pnpm run lint`: correcto.
- `pnpm test`: correcto.
- `pnpm run build`: correcto.
- Catalogo: 327 productos, sin IDs, codigos ni nombres oficiales duplicados.
- Supabase `main`: 6 pedidos, 47 lineas y 87 cambios.
- RLS esta activado en las cuatro tablas actuales.
- Auditor de seguridad de Supabase: sin alertas automaticas.
- Auditor de rendimiento: una FK sin indice y cuatro politicas que recalculan
  `auth.uid()` por fila.

La frase de aceptacion con seis productos se interpreta en seis lineas. Cinco
son de confianza alta y Aguacate queda en revision por la variante especifica
del catalogo. Esto es preferible a elegir silenciosamente.

## 2. Arquitectura existente

- `src/app.js`: coordinacion de UI, voz, edicion, historial y sincronizacion.
- `src/parser.js`: segmentacion, numeros, unidades, comandos y confianza.
- `src/catalog.js` y `src/catalog-data.js`: normalizacion y catalogo semilla.
- `src/requisitions.js`: modelo V10, validacion, historial y numeracion local.
- `src/storage.js`: persistencia y cola offline en `localStorage`.
- `src/supabase.js`: Data API REST con publishable key.
- `src/exporters.js`: PDF imprimible, XLSX y CSV.
- `service-worker.js`: cache PWA network-first.
- `supabase/migrations`: esquema V10, acceso autenticado y politica anon de
  demostracion.

Fortalezas que deben conservarse:

- No contiene `service_role` ni claves privadas.
- Los datos insertados en HTML pasan por escape antes de usar `innerHTML`.
- Cantidades no positivas y lineas dudosas bloquean confirmacion.
- El parser esta desacoplado y tiene pruebas deterministas.
- La sincronizacion resuelve colisiones de numero sin sobrescribir pedidos.
- La descarga combina datos y favorece cambios locales pendientes.
- La app no depende de red para crear y editar pedidos.

## 3. Problemas encontrados

### Criticos antes de produccion

1. La publicacion actual usa politicas `anon` con lectura y escritura sobre el
   espacio `main`. Cualquier persona con la URL y la publishable key puede
   consultar o modificar esos datos.
2. Los 327 productos, 6 pedidos y 87 cambios existentes tienen `owner_id` nulo
   porque fueron creados sin sesion autenticada.
3. `workspace_id` lo controla el cliente y no aisla organizaciones.

No se retirara el acceso anon hasta completar Auth, asignar una organizacion y
migrar los datos existentes. Retirarlo ahora romperia la aplicacion publicada.

### Estabilidad y sincronizacion

1. `localStorage` puede agotar cuota; los errores de escritura se registran en
   consola, pero la UI puede seguir mostrando "Guardado local".
2. La mezcla por `updated_at` no detecta ediciones concurrentes ni conserva dos
   versiones cuando ambos dispositivos cambian el mismo pedido.
3. La numeracion nace en el dispositivo. El renombrado por conflicto evita
   duplicados, pero no produce un consecutivo diario atomico en servidor.
4. La descarga limita a 500 pedidos y renderiza el historial completo.
5. El catalogo completo se vuelve a enviar en una sincronizacion general.

### PWA y versionado

1. La version se repite manualmente en HTML, imports, service worker y pruebas.
2. `package.json` indica 1.0.0, el runtime usa v10 y el manifest inicia con v1.
3. El service worker activa inmediatamente una version nueva sin informar.
4. No existe una accion visible para instalar la PWA.
5. Solo existe un icono SVG; se requieren pruebas y activos PNG antes de
   declarar compatibilidad completa con todas las plataformas.

### Parser y voz

1. Los casos actuales cubren 22 frases, no el dataset minimo de 150.
2. Funcionan digitos, enteros escritos y decimales con punto/coma.
3. Fallan `medio kilo`, `kilo y medio`, `tres cuartos` y `1/2`.
4. La unidad inferida se almacena con `unitExplicit=false`, pero no se muestra.
5. Los comandos se detectan, pero no todos modifican el pedido actual.
6. No existe contexto conversacional ni aprendizaje de correcciones.
7. Los errores de Web Speech muestran codigos tecnicos del navegador.

### UX y accesibilidad

1. A 320 px el numero de requisicion se parte y comprime Nuevo pedido.
2. Falta una revision enfocada exclusivamente en las lineas dudosas.
3. Faltan capacidad de voz, contador de escucha y aviso de privacidad.
4. La transcripcion parcial debe usar un `aria-live` explicito.
5. `app.js` supera 1.300 lineas y dificulta probar responsabilidades.
6. La pantalla tecnica de Supabase debera ser solo administrativa en V2.

### Seguridad web

1. No hay CSP. Agregarla sin preparar PDF puede romper el documento generado,
   que actualmente usa estilos y script inline.
2. La publishable key publica es correcta; la seguridad depende de Auth y RLS.
3. Se debe probar aislamiento cruzado desde SQL y cliente, no solo que RLS este
   habilitado.

## 4. Riesgos y estrategia de migracion

Prioridad absoluta: no perder los datos V10.

1. Mantener las claves de `localStorage` V1 durante toda la Fase 2.
2. Crear IndexedDB en paralelo y copiar, nunca mover, los datos V10.
3. Validar conteos, IDs, pedido actual, catalogo, configuracion y cola.
4. Marcar migracion exitosa solo cuando todas las transacciones terminen.
5. Conservar la copia V10 por al menos una version estable y ofrecer respaldo.
6. Crear tablas V2 sin alterar inicialmente las tablas V10.
7. Asignar los datos actuales a una organizacion de migracion y verificar
   conteos antes de desactivar las politicas anon.
8. Activar Auth y RLS V2 en una entrega coordinada y reversible.

## 5. Arquitectura propuesta

La PWA estatica puede conservarse. La modularizacion sera progresiva:

```text
src/
  app.js                   coordinacion y arranque
  version.js               version visible y cache
  db/indexeddb.js           almacenamiento transaccional
  db/migrate-v10.js         migracion local verificable
  auth/client.js            sesion Supabase
  auth/permissions.js       capacidades de UI
  sync/engine.js            cola, reintentos y conflictos
  sync/conflicts.js         comparacion de revisiones
  ui/voice.js               Web Speech y fallback
  ui/orders.js              pedido y edicion
  ui/review.js              resolucion secuencial de dudas
  ui/history.js             filtros y paginacion
  ui/admin.js               administracion separada
  voice/commands.js         comandos y contexto temporal
```

No se crearan todos los modulos por adelantado. Cada extraccion debe reducir
complejidad o permitir una prueba concreta.

## 6. Cambios de base de datos propuestos

Nuevas entidades para Fase 3 y posteriores:

- `organizations`
- `locations`
- `departments`
- `profiles`
- `organization_memberships`
- `department_memberships`
- `roles` y `membership_roles`
- `product_alias_learning`
- `requisition_templates`
- `requisition_receipts`

Las tablas actuales recibiran gradualmente `organization_id`, `location_id`,
`department_id`, `destination_department_id`, `requested_by_user_id`,
`revision_number`, prioridad, fecha requerida y marcas del flujo operacional.

Reglas de seguridad:

- IDs de organizacion y usuario no se aceptan por confianza desde el frontend.
- RLS consulta membresias controladas por base de datos.
- No usar `raw_user_meta_data` para autorizacion.
- Usar `(select auth.uid())` en politicas para evitar evaluacion por fila.
- Conceder acceso Data API explicitamente a `authenticated`.
- No crear politicas `anon` en produccion.
- Agregar indice a `requisition_items.product_id`.

## 7. Fases y orden

### Fase 0 - Auditoria

Estado: completada en este documento.

### Fase 1 - Estabilizacion

1. Unificar version visible y cache busting.
2. Avisar cuando exista una actualizacion del service worker.
3. Agregar instalacion PWA cuando el navegador la ofrezca.
4. Traducir errores de voz a mensajes operativos.
5. Corregir layout de 320 px y `aria-live`.
6. Ampliar pruebas estaticas y de version.
7. No cambiar esquema ni politicas remotas.

### Fase 2 - Datos locales

Estado: completada en `2.0.0-beta.2`.

- IndexedDB es la fuente principal con stores e indices separados.
- La migracion V10 copia, valida y conserva las seis claves originales.
- La migracion es idempotente y reanudable despues de una interrupcion.
- La cola consolida cambios y registra reintentos con backoff.
- La UI espera la escritura real y muestra los errores de guardado.
- Las pruebas cubren corrupcion parcial, reapertura, fallback, 1.000 productos y
  5.000 requisiciones.

Detalles operativos: `docs/LOCAL_STORAGE_MIGRATION.md`.

### Fase 3 - Auth y multiorganizacion

Estado: implementacion y backfill completados; validacion real y corte anonimo pendientes.

Supabase Auth, perfiles, organizaciones, ubicaciones, departamentos, roles,
backfill V10, RLS de aislamiento y retiro de anon.

### Fase 4 - Requisiciones V2

Estado: implementada y validada en codigo; prueba E2E multicuenta pendiente del
bootstrap de usuarios reales.

Modelo operacional, transiciones validas, destino, prioridad, fecha requerida,
recepcion y estado por linea.

### Fase 5 - Voice Engine V2

Estado: implementada y validada con 177 frases (100 % en dataset controlado).

Fracciones, comandos aplicables, contexto, ambiguedades, confianza explicable,
alias aprendidos y dataset de al menos 150 frases.

### Fase 6 - UX movil

Estado: implementada con voz por presion, revision priorizada, frecuentes,
plantillas y navegacion por permisos.

Pantalla centrada en voz, revision solo de dudas, frecuentes, favoritos y panel
administrativo separado.

### Fases 7 a 9

Fase 7: dashboard operativo implementado para manager/administrator con KPIs,
productos, faltantes, sustituciones, departamentos y filtros.

Fase 8: PDF descargable, XLSX de dos hojas, CSV compatible y Web Share
implementados.

Fase 9: implementada en `2.0.0-beta.3` con CSP, escaneo de secretos,
conflictos por revision, paginacion, prueba de 5.000 pedidos, exports y prueba
visual a 320/390 px. El estado general permanece **NOT READY** porque Supabase
no tiene usuarios/perfiles y por ello no se ejecutaron la matriz RLS ni el flujo
E2E multicuenta. La auditoria de cierre `2.0.0-beta.4` reforzo triggers,
numeracion, aislamiento local y exportaciones, pero mantiene **NOT READY**. El
acceso anonimo no se retira hasta completar ese bootstrap.

Checklist detallado: `docs/PRODUCTION_CHECKLIST.md`.

## 8. Archivos previstos

Fase 1:

- `package.json`
- `index.html`
- `styles.css`
- `service-worker.js`
- `manifest.webmanifest`
- `src/app.js`
- `src/version.js`
- imports versionados de `src/*.js`
- `tools/static-smoke.mjs`
- `tools/sync-version.mjs`
- `README.md`
- `docs/ARCHITECTURE.md`

Fases posteriores agregaran los modulos de `db`, `auth`, `sync`, `ui` y
las migraciones descritas. No se modificara el esquema remoto en Fase 1.

## 9. Pruebas requeridas

- Mantener `lint`, `test` y `build` verdes en cada commit.
- Verificar consistencia de version y cache automaticamente.
- Probar actualizacion de service worker con una version anterior activa.
- Probar instalacion disponible y navegador sin soporte.
- Probar voz no soportada, permiso denegado, red y ausencia de microfono.
- Probar 320, 390, tablet y escritorio sin solapamientos.
- En Fase 2: migracion completa, parcial, repetida y recuperacion de error.
- En Fase 3: matriz RLS por organizacion, ubicacion, departamento y rol.
- En Fase 5: dataset versionado, precision por categoria y objetivo >= 95 %.
- En Fase 9: 1.000 productos, 5.000 pedidos, offline y edicion concurrente.

## 10. Criterios para avanzar

Una fase termina solo cuando sus pruebas pasan, la migracion es reversible y no
existe regresion en creacion manual, voz, catalogo, historial, exportaciones,
offline o sincronizacion. Auth no se activara en produccion hasta que los datos
existentes tengan organizacion y propietario validos.
