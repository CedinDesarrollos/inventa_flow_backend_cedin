# Actualizaciones de dependencias y compatibilidad

Se actualizaron dependencias dentro de sus familias compatibles y los lockfiles. Las versiones mínimas de los paquetes directos se elevaron a las versiones instaladas verificadas. Ambos proyectos declaran Node 24, el runtime usado para build y pruebas; seleccionar esa versión en el servicio de deploy.

## Backend

- Prisma CLI, cliente y adaptador PostgreSQL: 7.10.0, alineados. No se cambió el esquema ni la baseline de migración.
- Baileys: 7.0.0-rc14, corrige el aviso crítico de mensajes de protocolo maliciosos. Permanece una versión candidata de la familia 7 que el proyecto ya utilizaba.
- Nodemailer: 10.1.0, con tipos actualizados. Verificado creando MIME en memoria, sin enviar correo.
- Express 5.3.0, rate-limit 8.7.1 y Multer 2.4.0; actualizadas también dependencias transitivas vulnerables.
- Overrides temporales de deepmerge-ts 8.0.2 y mysql2 >=3.24.0 para dependencias transitivas de Prisma CLI. Configuración, generación, diff, migración, baseline y build comprobados. No se usa MySQL en la aplicación; retirar los overrides cuando Prisma adopte versiones corregidas.
- Baileys comprobado con creación/recarga de credenciales y almacenamiento/recuperación de claves binarias mediante la capa de persistencia del proyecto. No se vinculó una cuenta ni se enviaron mensajes reales.

## Frontend

- Axios 1.20.0, jsPDF 4.2.1, React Router 7.18.4 y Vite 7.3.7.
- Tiptap 3.31.4 en todos los paquetes del editor. StarterKit desactiva su Link incorporado para evitar duplicarlo con la configuración explícita. Sincronizar contenido y modo editable no emite onUpdate; conserva historial, listas, encabezados y nodo PDF en las pruebas.
- xlsx eliminado. Exportaciones de NPS y recordatorios usan write-excel-file 4.1.1; conservan nombres, columnas y valores numéricos. El texto que empieza por '=' se exporta como texto. Recordatorios descarga un solo archivo, eliminando la llamada duplicada anterior.
- Override temporal de postcss-selector-parser >=7.1.6 para typography; build CSS aprobado. Retirar cuando la dependencia padre actualice su rango.

## Correo y credencial retirada

Se eliminó una credencial SMTP embebida en src/lib/email.ts. Configurar SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD y SMTP_FROM mediante variables del entorno; .env.example contiene los nombres sin contraseña.

Rotar la credencial anterior en el proveedor antes del deploy: retirarla del código actual no la borra del historial. Sin SMTP_USER y SMTP_PASSWORD, las funciones de correo devuelven false y registran configuración ausente; no intentan enviar correo anónimo. Verificar recuperación de contraseña y bienvenida en staging tras configurar el proveedor. No se rotó ni se cambió una cuenta externa desde este entorno.

## Validación y límites

- npm audit completo (incluidas dependencias de desarrollo): cero avisos en ambos proyectos con los lockfiles finales.
- Instalación limpia y build de ambos proyectos aprobados; validación Prisma aprobada.
- Backend: 30 pruebas, incluidas PostgreSQL real, concurrencia, migraciones y notificaciones locales.
- Frontend: 3 pruebas de compatibilidad: Excel real descomprimido, PDF/AutoTable y montaje/edición/historial del editor con DOM simulado.
- La prueba del editor usa DOM simulado, no sustituye la revisión en navegador de todos los formularios. La conexión real de WhatsApp y el envío SMTP requieren cuentas de prueba en staging.
- Lint sigue pendiente del paso 5: 503 errores y 27 advertencias con las herramientas actualizadas. Las reglas nuevas detectan más casos que la versión anterior. No se desactivaron reglas para ocultarlos.
