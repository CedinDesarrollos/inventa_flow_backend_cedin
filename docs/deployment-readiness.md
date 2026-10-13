# Verificación y despliegue en Railway

El arranque usa `node dist/index.js` y no aplica cambios de esquema. La migración es una operación independiente: consultar [database-migrations.md](database-migrations.md), comparar el esquema destino y comprobar un backup restaurable antes de resolver una baseline o aplicar SQL.

## Controles del candidato

Usar Node 24 y los lockfiles versionados. `npm ci --include=dev` genera Prisma. `npm run check` compila, ejecuta pruebas y valida el esquema. Tras compilar, `npm run check:config` comprueba la configuración del entorno sin arrancar ni imprimir valores de variables. La CI usa PostgreSQL 16 y `TEST_DATABASE_URL` local para activar las pruebas de integración; sin esa variable, las tres pruebas con base real se omiten deliberadamente. Las pruebas crean y eliminan únicamente bases locales propias con datos sintéticos.

`railway.json` prepara el build con instalación reproducible y controles, `npm start`, health `/api/health` y reinicio ante fallo. No aplicar migraciones en el build ni en el start. Health mide disponibilidad HTTP; comprobar también una operación autenticada contra la base destino.

Las pruebas fijan NODE_ENV=test en un subproceso para conservar las comprobaciones de React y aislar el comportamiento de test del entorno del constructor. Correo se verifica con un transporte MIME en memoria; WhatsApp con persistencia de sesión simulada. No se contactan pacientes.

## Variables del destino

| Variable | Comprobación |
| --- | --- |
| DATABASE_URL | PostgreSQL correcto; verificar conexión/TLS en staging y destino sin mostrar credenciales. |
| JWT_SECRET | Presente, secreto fuerte gestionado fuera del repositorio. |
| NODE_ENV | production |
| PORT | Puerto proporcionado por Railway. |
| CORS_ORIGIN | Dominios exactos del frontend separados por comas; el parser recorta espacios e ignora entradas vacías. |
| PUBLIC_URL | URL HTTPS pública del backend, sin `/api` ni `/uploads`, para enlaces de archivos y WhatsApp. |
| API_URL | Puede ser el hostname privado; los enlaces externos priorizan PUBLIC_URL. |
| FRONTEND_URL | URL HTTPS del frontend para enlaces de correo. |
| UPLOAD_DIR | `/app/public/uploads`, coincidente con el volumen del servicio. |
| SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASSWORD / SMTP_FROM | Configurar según proveedor y rotar la credencial anteriormente expuesta. No copiarla de Git. |

El frontend debe compilar con `VITE_API_URL=https://inventaflowbackendcedin-production.up.railway.app/api`. Cambiar la variable requiere reconstruir. La compilación rechaza URL vacía, HTTP local y dominio interno de Railway.

La validación de arranque comprueba presencia/formato de las variables esenciales, PUBLIC_URL público y HTTPS en producción. No certifica la fortaleza del secreto, el contenido del volumen ni la conectividad a PostgreSQL.

## Secuencia antes del deploy

1. Revisar y versionar los cambios candidatos de ambos repositorios; repetir CI sobre esos commits. Los resultados locales corresponden al árbol de trabajo actual.
2. Crear un staging aislado con PostgreSQL 16, volumen y datos sintéticos. Usar credenciales separadas y desactivar envíos o dirigirlos a cuentas de prueba. La sesión actual no creó ni desplegó un staging en Railway.
3. Confirmar variables y volumen; revisar esquema/historial de migraciones y restaurar un backup en una base aislada. La baseline del repositorio no demuestra que producción coincida.
4. Ensayar login/permisos, pacientes, agenda y sobreturnos, cobros, reportes, archivos tras reinicio y notificaciones con cuentas de prueba. Revisar logs y conexión real con TLS.
5. Guardar referencias de la versión anterior y comprobar compatibilidad del esquema. Un rollback de código no revierte SQL ni datos; restauración o reparación requiere una decisión independiente.
6. Confirmar que Railway espera los checks de CI, o revisar explícitamente su resultado antes de desplegar. Los servicios observados no esperaban check suites; los controles locales no cambian esa opción de la infraestructura.
7. Presentar los resultados del destino y acordar el deploy. Esta corrección no autoriza ni ejecuta un deploy de producción.

## Observación del 12 de octubre de 2026

Proyecto Cedin: únicamente un entorno production. Frontend y backend con últimos despliegues SUCCESS, builder RAILPACK y fuente main. Frontend con dominios Railway y admin.cedin.com.py, puerto 8080. Backend con dominio público Railway y volumen montado en `/app/public/uploads`. PostgreSQL del destino usa imagen SSL versión 16. Estos datos de inventario no certifican el funcionamiento del candidato nuevo.

El conector muestra nombres de variables, no valores. El usuario confirmó VITE_API_URL, CORS_ORIGIN y PUBLIC_URL (https://inventaflowbackendcedin-production.up.railway.app), y comunicó que SMTP ya está configurado. La rotación de la credencial anterior no se verificó por separado, ni se probó el envío real. No se verificó el esquema/historial, backup restaurable ni conexión real/TLS de producción. El cliente existente habilita TLS con rejectUnauthorized=false; la validación del certificado sigue siendo una limitación de la configuración actual y requiere revisar el certificado del destino antes de endurecerla.
