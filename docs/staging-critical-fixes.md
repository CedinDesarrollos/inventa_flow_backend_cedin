# Correcciones críticas de aceptación de staging

La aceptación de staging encontró hashes de contraseña/PIN en relaciones de usuario y cobros iniciales que superaban el total, dejando saldo negativo.

## Respuestas de perfiles

`userProfileSelect` permite explícitamente campos de perfil y excluye hashes. Se usa en médicos de citas y notas del detalle de paciente, usuarios de profesionales y disponibilidad, y respuesta de registro. La agenda conserva el perfil profesional que necesita el frontend; los nombres, usernames, identificadores y estado de usuario permanecen disponibles. El reporte de recordatorios deja de cargar un médico que no utiliza.

No se cambian los hashes almacenados ni el proceso de autenticación. El login sigue verificando la contraseña y devolviendo su respuesta específica.

## Cobros iniciales

La validación rechaza con 400 el pago inicial o la suma de pagos divididos que supera el total, antes de abrir una transacción de base de datos. Comprueba tanto el importe recibido como los importes redondeados individualmente a dos decimales, igual que su almacenamiento en PostgreSQL. Evita que varios redondeos de pagos produzcan saldo negativo aunque la suma recibida parezca suficiente.

Los saldos y la suma de pagos se calculan con `Prisma.Decimal`. Los pagos divididos siguen teniendo prioridad frente al campo legacy `initialPayment`; un array vacío conserva el comportamiento legacy. Los pagos divididos que se redondearían a cero se rechazan. Un pago inicial cero, parcial o exactamente igual al total sigue permitido. PROFESSIONAL conserva el permiso de crear cobros iniciales, confirmado por el usuario.

La corrección no modifica transacciones históricas, permisos de abonos posteriores, relación de cita/transacción ni esquema/migraciones. La prueba que ya creó un saldo negativo en staging se conserva como dato sintético histórico.

## Regresiones

- HTTP sin base real: sobrepagos únicos, divididos y causados por redondeos producen 400 sin ejecutar `$transaction`.
- PostgreSQL real desechable: respuestas de agenda, detalle de paciente, profesionales y disponibilidad para ADMIN, DEVELOPER, SECRETARY y PROFESSIONAL no contienen campos de credenciales. Verifica también la respuesta de registro y que las relaciones necesarias para el frontend permanecen.
- PostgreSQL real: siete payloads inválidos no crean transacciones, ítems o pagos ni cambian la cita vinculada. Comprueba pago cero, pago completo, pagos divididos completos, suma decimal 0.1 + 0.2 y almacenamiento a dos decimales; los cobros válidos de PROFESSIONAL siguen pasando.

Ejecutar `npm run check` con `TEST_DATABASE_URL` apuntando a PostgreSQL local desechable para incluir las regresiones con base real. La CI aporta PostgreSQL 16 y ejecuta esos casos. Esta corrección sigue el PR de backend #2 y se valida en Cedin Staging antes de considerar producción.
