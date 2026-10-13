# Cierre por día de clínica y conciliación de abonos

Los filtros YYYY-MM-DD de transacciones y el cierre usan America/Asuncion, con inicio incluido y fin excluido. Los turnos se separan a las 14:00 de la clínica: un recibo exactamente a esa hora pertenece solo a la tarde. Luxon aplica las reglas de la zona, incluidas las fechas históricas con un offset distinto.

`GET /api/transactions?cashFlow=true&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` devuelve una fila por recibo del rango, con reportRowId, su hora, importe, método y cajero. Incluye los abonos a ventas de días anteriores. El filtro authorId identifica al autor del recibo; la vista habitual sin cashFlow conserva el filtro de creación de la transacción. El fallback para registros históricos sin recibos se conserva por fecha de creación. Los descuentos/coberturas de una venta se muestran una sola vez en su día de creación.

## Relación de cobros y citas

La migración 20261013010000_transaction_appointment agrega appointment_id nullable, índice y FK con ON DELETE SET NULL. No cambia la baseline ni elimina filas. Los registros anteriores quedan NULL; no se infieren relaciones por paciente o fechas. Se probó la actualización con datos previos, la instalación desde cero, la repetición del SQL aditivo y la preservación de la baseline verificada.

Las nuevas transacciones guardan su appointmentId y validan que el paciente/profesional coincide. Al crear, abonar o anular una transacción vinculada, se recalcula el estado de pago de la cita con todas sus cuentas no anuladas: PAID si todas tienen saldo cero, PARTIAL si hay importes pagados y todavía deuda, PENDING en los otros casos. La consulta y actualización están en la misma transacción de base de datos. Los locks se toman en orden cita -> cuenta para serializar abonos y evitar que dos cajeros liquiden el mismo saldo simultáneamente.

## Cuentas históricas sin vínculo

ADMIN o DEVELOPER pueden asociar una cuenta conocida usando `PATCH /api/transactions/:id/appointment` con `{ "appointmentId": "UUID" }`. Se valida el paciente/profesional, se impide transferir una cuenta ya vinculada a otra cita, y se concilia también si la cuenta ya está liquidada. Repetir la asociación a la misma cita es idempotente. El endpoint no puede deducir a qué consulta pertenece una cuenta anterior; hace falta una asociación revisada y explícita.

En staging se aplica la migración mediante el predeploy existente. Antes de producción, revisar y aplicar esta migración aditiva sobre un backup restaurable; un rollback de código puede conservar la columna. El deploy de producción y la reparación masiva de datos históricos no se ejecutan como parte de la verificación de staging.
