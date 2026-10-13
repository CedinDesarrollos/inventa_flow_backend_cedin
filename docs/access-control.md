# Control de acceso del backend

Las rutas de citas requieren JWT con identidad y uno de los roles ADMIN, DEVELOPER, SECRETARY o PROFESSIONAL.

- ADMIN, DEVELOPER y SECRETARY pueden gestionar la agenda general.
- PROFESSIONAL solo puede consultar, crear, editar, cambiar estado y eliminar citas propias. No puede transferir una cita a otro profesional.
- La consulta sin doctorId se limita al profesional autenticado. Crear una cita o cerrar la agenda sin doctorId también se limita a ese profesional.
- Un profesional no puede operar sobre una cita sin doctor asignado o perteneciente a otro profesional.
- JWT ausente, inválido, vencido o sin identidad devuelve 401. Acceso fuera del rol o agenda permitidos devuelve 403. Una cita inexistente en la comprobación de propiedad devuelve 404.

Disponibilidad, fichas clínicas, reportes, uploads, recordatorios y gestión de WhatsApp requieren autenticación explícita en su router. Conservan los flujos existentes de usuarios autenticados; este cambio no establece una nueva política completa de permisos por paciente para todos los módulos.

Crear usuarios por `/api/auth/register` o `/api/users`, editar usuarios (incluido rol), eliminarlos y resetear sus contraseñas requiere ADMIN o DEVELOPER. Cambiar la contraseña propia sigue disponible mediante `/api/auth/change-password`.

`/api/health` es público y devuelve solo estado y timestamp. `/api/db-check` requiere ADMIN o DEVELOPER. Login, recuperación de contraseña y webhooks conservan su acceso público previsto; sus validaciones internas no fueron modificadas aquí.

Los middlewares de pagos y costos, aunque los routers se montan bajo `/api`, solo se aplican a sus propios paths. No afectan health, medicamentos o rutas ajenas. El router de costos se monta una sola vez.

La aplicación HTTP está en `src/app.ts`; `src/index.ts` arranca el servidor y las tareas programadas. Las pruebas HTTP importan la aplicación sin iniciar crons.
