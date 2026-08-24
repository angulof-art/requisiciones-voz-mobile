# Distribucion de requisiciones por correo

## Estado

El modulo vive en la rama `feature/email-distribution`. La base de datos y la
Edge Function estan desplegadas, pero `email_distribution_settings.enabled`
permanece en `false`. No se configuraron correos reales, dominio ni secretos de
Resend, y no se realizaron envios reales.

## Flujo

1. El usuario guarda y sincroniza una requisicion valida.
2. Pulsa `Enviar por correo`.
3. Elige Almacen / Abarrotes, Verduras, Evento especial o Personalizado.
4. Revisa destinatarios sugeridos y TO, CC o BCC.
5. Revisa la vista previa obligatoria.
6. Confirma el envio.
7. La Edge Function vuelve a leer y autorizar todos los datos en Supabase.
8. Resend acepta el mensaje y se guarda la auditoria con snapshots.

No se envia al confirmar una requisicion ni al seleccionar un grupo. Un pedido
mixto ofrece enviar completo o separar, pero nunca genera varios correos sin
confirmacion.

## Arquitectura

```text
PWA autenticada
  -> src/email/ui.js
  -> src/email/distribution.js + preview.js
  -> src/email/api.js
  -> Supabase Edge Function (JWT de usuario obligatorio)
       -> lecturas con cliente del usuario y RLS
       -> validacion de membresia, permiso, revision y destinatarios
       -> escritura minima de auditoria con cliente administrativo
       -> ResendEmailProvider
```

El navegador solo envia IDs, la revision esperada, una nota, el nombre opcional
del evento y un UUID de operacion. La funcion obtiene del servidor el pedido,
las lineas, los departamentos, el grupo y los emails. La publishable key no
sustituye el JWT del usuario.

## Modulos frontend

- `src/email/permissions.js`: capacidades del modulo.
- `src/email/distribution.js`: seleccion, deduplicacion, reglas y split.
- `src/email/preview.js`: asunto y vista previa HTML escapada.
- `src/email/api.js`: consultas RLS e invocacion de la funcion.
- `src/email/ui.js`: formulario movil, administracion e historial.

## Tablas

- `email_distribution_settings`: feature flag, proveedor y limites por organizacion.
- `email_recipients`: destinatarios activos o desactivados; no se borran historicos.
- `email_distribution_groups`: grupos configurables.
- `email_distribution_group_recipients`: miembros, TO/CC/BCC, predeterminado y requerido.
- `email_distribution_rules`: categoria o seleccion explicita que sugiere un grupo.
- `requisition_email_sends`: intento, resultado, idempotencia y snapshot del asunto.
- `requisition_email_send_recipients`: nombre, email y tipo de entrega historicos.

Los grupos iniciales son `WAREHOUSE`, `VEGETABLES` y `SPECIAL_EVENT`. No
contienen direcciones inventadas. Al crear un destinatario, su tipo propone las
membresias iniciales:

| Tipo | Almacen | Verduras | Evento especial |
| --- | --- | --- | --- |
| Almacen | Si | Si | Si |
| Compras | No | Si | Si |
| Seguridad | No | Si | No |
| Contraloria | No | Si | Si |
| Costos | No | Si | Si |

El administrador puede cambiar todas estas membresias posteriormente.

## RLS y permisos

Todas las tablas nuevas tienen RLS. No existen grants ni politicas para `anon`.
La configuracion se lee solo dentro de organizaciones con membresia activa y
una capacidad del modulo. Las tablas de auditoria son de solo lectura para el
cliente; la Edge Function es la unica que inserta o actualiza intentos.

| Rol | send | recipients.manage | groups.manage | send_external | audit.read |
| --- | --- | --- | --- | --- | --- |
| administrator | Si | Si | Si | Si | Si |
| manager | Si | No | Si | No | Si |
| requester | Si | No | No | No | No |
| receiver | No | No | No | No | No |

Un destinatario `required` no puede desmarcarse en el pedido. Los correos
externos requieren simultaneamente `allow_external` en la organizacion y
`email.send_external` en el usuario. El limite inicial es 25 destinatarios.

## Edge Function

`send-requisition-email` usa `withSupabase({ auth: "user" })` y se despliega
con `verify_jwt = true`. Ademas verifica:

- origen CORS permitido;
- usuario y membresia activos;
- `email.send`;
- lectura RLS de la requisicion;
- revision y estado enviables;
- lineas pertenecientes al pedido;
- grupo y destinatarios de la misma organizacion;
- destinatarios requeridos y emails validos;
- permiso para externos, limites y rate limit.

El rate limit es de 5 intentos por minuto y 50 por dia por usuario. El UUID de
operacion, revision, grupo y conjunto normalizado de destinatarios forman la
clave idempotente. Resend recibe la misma clave. `sent` significa que el
proveedor acepto el mensaje, no que fue entregado o leido.

## Seguridad del contenido

El asunto elimina CR/LF y tiene un maximo de 240 caracteres. La nota tiene un
maximo de 2.000. Producto, notas, responsables, eventos y departamentos se
escapan antes de entrar al HTML. Los errores de UI y auditoria no incluyen JWT,
headers, API keys ni el cuerpo tecnico del proveedor.

## Configuracion administrativa

1. Entre como `administrator` y abra `Correo`.
2. Cree los destinatarios reales de Compras, Seguridad, Contraloria, Almacen y
   Costos, indicando el tipo correcto.
3. Revise `Miembros por grupo`; ajuste seleccion, TO/CC/BCC y `Requerido`.
4. Revise las reglas de categorias y mantenga Evento especial como seleccion
   explicita.
5. Configure y pruebe Resend antes de activar `Envio por correo`.
6. Active el modulo y guarde la configuracion.

Desactivar un destinatario evita nuevos usos sin borrar los snapshots de
envios anteriores.

## Configuracion de Resend

1. Cree o seleccione una cuenta de Resend autorizada por la empresa.
2. Verifique un dominio propio y complete los registros DNS indicados por
   Resend.
3. Genere una API key limitada para envios.
4. Configure los secretos de la Edge Function:

```powershell
supabase secrets set --project-ref cgfxvrpqcwjafvfcccnj `
  RESEND_API_KEY="valor-secreto" `
  REQUISITION_EMAIL_FROM="Pedidos por Voz <cuenta@dominio-verificado>"
```

Opcionales:

```powershell
supabase secrets set --project-ref cgfxvrpqcwjafvfcccnj `
  REQUISITION_EMAIL_REPLY_TO="cuenta-operativa@dominio-verificado" `
  REQUISITION_ALLOWED_ORIGINS="https://angulof-art.github.io,http://127.0.0.1:4177"
```

No coloque estos valores en `src/config.js`, `.env` del frontend, IndexedDB,
localStorage ni GitHub. Despliegue luego:

```powershell
supabase functions deploy send-requisition-email --project-ref cgfxvrpqcwjafvfcccnj
```

Haga una unica prueba con un destinatario QA autorizado. Solo despues agregue
destinatarios operativos y active el feature flag.

## Errores y recuperacion

- Modulo apagado: la PWA muestra `Envio por correo todavia no configurado`.
- Pedido sin sincronizar u offline: el boton permanece deshabilitado.
- Revision modificada: se exige recargar la vista previa.
- Envio repetido: se solicita confirmacion expresa para reenviar.
- Fallo del proveedor: el intento queda `failed` y nunca `sent`.
- Pedido posterior al ultimo envio: la vista indica actualizacion y el nuevo
  asunto empieza con `ACTUALIZACION`.

## Limitaciones iniciales

- No hay webhooks de delivered, bounced o complained.
- No se adjunta PDF; el correo contiene la tabla completa en HTML.
- No hay Microsoft Graph; el adaptador permite sustituir Resend despues.
- No se ha hecho un envio real porque no hay dominio, secretos ni destinatario
  QA autorizados configurados.
