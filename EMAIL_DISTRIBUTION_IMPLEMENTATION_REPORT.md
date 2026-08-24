# Email Distribution Implementation Report

## Estado

**NOT READY**

El modulo esta implementado, probado y desplegado de forma desactivada. No esta
listo para habilitarse en produccion porque aun faltan un dominio verificado,
los secretos de Resend, los destinatarios operativos y una prueba real con un
destinatario QA autorizado. No se envio ningun correo real.

## 1. Branch

`feature/email-distribution`

No se mezclo en `main`, no se promovio a RC y no se publico en GitHub Pages.
La version general permanece en `2.0.0-beta.5`.

## 2. Commits

- `ac73d47` `feat: add email distribution schema`
- `9e2d862` `feat: add requisition email distribution UI`
- `5acc0db` `feat: add secure requisition email function`
- `2b0309d` `test: cover email distribution workflows`
- `92af659` `docs: document email distribution module`

## 3. Tablas

- `email_distribution_settings`
- `email_recipients`
- `email_distribution_groups`
- `email_distribution_group_recipients`
- `email_distribution_rules`
- `requisition_email_sends`
- `requisition_email_send_recipients`

Las migraciones se aplicaron al proyecto `cgfxvrpqcwjafvfcccnj`. Los indices
de claves foraneas fueron revisados con Performance Advisor.

## 4. RLS

- RLS activo en las siete tablas.
- Cero politicas para `anon` o `public`.
- Cero grants de tabla para `anon` o `public`.
- Cero grants de escritura autenticada sobre las dos tablas de auditoria.
- Prueba transaccional: una membresia no ve configuracion de otra organizacion.
- Prueba transaccional requester: ve sus tres grupos, pero no puede crear
  destinatarios.
- Invocacion anonima de la Edge Function: `401 Invalid credentials`.

## 5. Permisos

Se agregaron `email.send`, `email.recipients.manage`, `email.groups.manage`,
`email.send_external` y `email.audit.read`. Administrator recibe todos;
manager recibe send, groups y audit; requester recibe send; receiver ninguno.

## 6. Grupos iniciales

- `WAREHOUSE`: solo Almacen por defecto.
- `VEGETABLES`: Compras, Seguridad, Contraloria, Almacen y Costos.
- `SPECIAL_EVENT`: Compras, Contraloria, Almacen y Costos; Seguridad no se
  incluye automaticamente.

No se insertaron correos reales ni inventados.

## 7. UI

Se agregaron el boton `Enviar por correo`, formulario de dos pasos, vista
previa, TO/CC/BCC, requeridos, personalizado, externos con permiso, pedido
mixto, actualizaciones, reenvio confirmado, historial y administracion de
destinatarios, grupos, miembros y reglas.

QA responsive: 320, 360, 390, 768 y 1280 px sin overflow del documento,
dialogo o filas. Los controles medidos mantienen al menos 44 px.

## 8. Edge Function

`send-requisition-email`, despliegue remoto version 2, estado `ACTIVE`, con
`verify_jwt=true`. Las lecturas usan el cliente del usuario y RLS. El cliente
administrativo solo crea y actualiza auditoria despues de validar usuario,
membresia, permiso, pedido, revision, lineas, organizacion y destinatarios.

## 9. Proveedor

Se implemento `ResendEmailProvider` detras de una interfaz simple. El modulo
guarda `provider_message_id` y considera `sent` como aceptado por el proveedor,
no entregado ni leido. No hay webhooks en esta version.

## 10. Secrets necesarios

Obligatorios y exclusivos de Edge Functions:

- `RESEND_API_KEY`
- `REQUISITION_EMAIL_FROM`

Opcionales:

- `REQUISITION_EMAIL_REPLY_TO`
- `REQUISITION_ALLOWED_ORIGINS`

No se guardaron secretos en frontend, GitHub, IndexedDB ni localStorage.

## 11. Tests

- Grupos Almacen, Verduras y Evento especial.
- Personalizado, required, deduplicacion y pedido mixto.
- Matriz de permisos y externos.
- Preview, prioridad, actualizacion, CRLF y escape HTML.
- Email valido e invalido.
- Huella, idempotencia y snapshots.
- Provider mock success/failure sin red real.
- Controles estaticos de RLS, grants, auditoria y Auth de la funcion.
- Suite general: voz 177/177, workflow, IndexedDB, concurrencia, integracion y
  5.000 requisiciones.

Resultados finales antes del informe:

```text
pnpm run lint  PASS
pnpm test      PASS
pnpm run build PASS
```

## 12. Advisors

Security Advisor no reporta problemas nuevos del modulo. Permanecen tres
hallazgos previos fuera de este alcance: secuencia diaria sin politica de
lectura, RPC `next_requisition_number` SECURITY DEFINER ejecutable por
authenticated y proteccion de contrasenas filtradas desactivada.

Performance Advisor reporta cero claves foraneas nuevas sin indice. Los
indices nuevos aparecen como no usados porque el feature flag esta apagado y
las tablas aun no tienen trafico.

## 13. Configuracion pendiente

1. Verificar un dominio empresarial en Resend y completar DNS.
2. Crear una API key limitada y guardar los secretos de Edge Functions.
3. Crear los destinatarios reales desde Administracion.
4. Revisar miembros y TO/CC/BCC de cada grupo.
5. Hacer una prueba con un unico destinatario QA autorizado.
6. Activar `email_distribution_settings.enabled` solo despues del PASS.

## 14. Limitaciones

- Sin tracking delivered/bounced/complained.
- Sin PDF adjunto; el pedido va completo en HTML.
- Sin Microsoft Graph.
- El envio requiere conexion y pedido sincronizado.
- No se ejecuto prueba real de provider por falta de configuracion autorizada.

## 15. Readiness

La arquitectura, seguridad, UI y pruebas locales/remotas estan listas para QA
operativo. La rama no debe mezclarse ni habilitarse hasta completar la
configuracion pendiente y demostrar los casos de aceptacion con provider real.
