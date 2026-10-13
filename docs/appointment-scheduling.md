# Integridad de citas

Crear y reprogramar usa transacciones. Una edición vuelve a leer la cita existente y combina solamente los campos enviados: omitir isOverbooking conserva su valor. Los cambios de fecha o duración recalculan endDate sin desplazar la hora UTC. Cambiar solo notas conserva el intervalo.

Al cambiar intervalo, profesional, estado o sobreturno, se comprueba la disponibilidad efectiva. La consulta excluye la propia cita, ignora citas CANCELLED y permite intervalos contiguos (fin de una cita igual al inicio de otra). Conserva las excepciones existentes: sobreturnos explícitos y atención espontánea/CONFIRMED. Pasar una cita a SCHEDULED o quitarle sobreturno vuelve a comprobar conflictos.

Las colisiones y disponibilidad calculan fin como date + duration. Esto impide que un endDate antiguo nulo o incoherente oculte una cita ocupada. La disponibilidad también contempla citas que comienzan el día anterior y atraviesan el horario consultado.

Cada escritura del servicio obtiene un advisory lock de transacción por profesional. Las transferencias bloquean ambos profesionales en orden estable; las ediciones también bloquean la fila antes de releerla. Bajo el aislamiento PostgreSQL habitual READ COMMITTED, la comprobación posterior al lock ve las escrituras anteriores y evita que dos creaciones/reprogramaciones normales concurrentes ocupen el mismo horario. Los scripts externos que escriban citas directamente deben adoptar el mismo protocolo; los sobreturnos siguen permitidos deliberadamente.

HTTP: conflictos 409, datos inválidos 400, cita inexistente 404 y edición fuera de la agenda del profesional 403. Los errores inesperados conservan 500.

`npm run db:inspect-intervals` hace un inventario de solo lectura: total, fin nulo/incoherente y duración inválida. No imprime pacientes ni repara datos. Revisar el inventario sobre la base destino antes de planificar una reparación histórica; no se modificaron datos de producción aquí.

Las pruebas PostgreSQL cubren fecha sola, duración sola, ambos campos, límites exactos, cambio de profesional, exclusión de la propia cita, sobreturnos, edición de notas, legacy endDate, entrada inválida y carreras de creación/reprogramación.
