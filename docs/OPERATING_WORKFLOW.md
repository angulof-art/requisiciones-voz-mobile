# Flujo operativo de requisiciones

## Alcance

La requisicion conserva un UUID inmutable y un numero legible. Cuando hay
conexion, `next_requisition_number` reserva el consecutivo diario dentro de una
transaccion en PostgreSQL. Offline se utiliza un numero provisional local; la
sincronizacion resuelve una eventual colision sin cambiar el UUID.

## Estados

La maquina de estados vive en `src/workflow.js` y su equivalente de base de
datos se valida mediante el trigger `enforce_requisition_transition`.

`draft -> review|submitted -> received -> preparing -> partial|delivered -> accepted -> closed`

`rejected` y `voided` son finales. Los estados heredados `confirmed` y
`exported` se conservan para no perder compatibilidad con datos V10.

## Responsabilidades

- Requester: crea, revisa, envia y acepta una entrega destinada a otro
  departamento.
- Receiver: ve solo pedidos dirigidos a uno de sus departamentos, los recibe,
  prepara y registra cantidades entregadas, faltantes o sustituciones.
- Manager/administrator: consulta el flujo de su organizacion y cierra pedidos
  aceptados conforme a sus permisos.

Los controles de interfaz mejoran la experiencia, pero Supabase RLS es la
autoridad de acceso.

## Lineas y entrega

Cada linea conserva cantidad solicitada, cantidad entregada, estado de
cumplimiento, razon de falta de existencia y producto sustituto. Una entrega
parcial exige una cantidad mayor que cero y menor que la solicitada. Un faltante
exige razon y una sustitucion exige producto sustituto.

## Auditoria

Los cambios locales registran actor, usuario, fecha, dispositivo y origen. Las
transiciones remotas generan ademas una entrada desde el trigger de PostgreSQL,
por lo que una manipulacion directa de la API tambien deja trazabilidad.

## Offline

Los borradores y sus cambios se guardan en IndexedDB y se encolan por usuario y
organizacion. El envio puede completarse sin red con numero provisional; al
recuperar conexion se sincroniza contra Supabase y se descarga el estado remoto.

## Migraciones

- `202608220009_add_requisition_workflow.sql`: campos, estados, cantidades,
  secuencia diaria, politicas y auditoria.
- `202608220010_expose_organization_directory.sql`: lectura del directorio
  activo para miembros de la misma organizacion, necesaria para elegir destino.
