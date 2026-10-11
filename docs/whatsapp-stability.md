# Corrección de estabilidad de WhatsApp

Las respuestas de confirmar, cancelar y reagendar reutilizan `notificationService`. No crean proveedores ni abren Baileys. Twilio se inicializa al primer envío y reutiliza su cliente, de modo que los recordatorios, plantillas, respuestas automáticas y el envío al representante conservan su comportamiento.

La conexión manual inicializa solamente Baileys. Los mensajes manuales conservan el envío por WhatsApp conectado y la alternativa por Twilio cuando está desconectado, además de adjuntos, mensajes entrantes y confirmaciones de lectura.

Baileys comparte el intento de inicialización entre llamadas concurrentes, utiliza un único socket y un único temporizador de reconexión, y espera progresivamente de 2 a 60 segundos ante fallas consecutivas. Una conexión exitosa reinicia esa espera. Los eventos de sockets retirados se ignoran y sus listeners se liberan antes de cerrar. Desconectar cancela los reintentos e invalida autenticaciones pendientes. El cache de reintentos tiene expiración de diez minutos sin un intervalo que retenga proveedores inactivos.

El manejador de recuperación de errores de cifrado se registra solamente mientras el proveedor está activo y se elimina al detenerlo. La recuperación de cifrado y una desconexión normal conservan las credenciales. El botón de cerrar sesión y un cierre auténtico por falta de autorización conservan la posibilidad de borrar la sesión y vincular nuevamente con QR.

## Validación

```sh
npm run build
node tests/whatsapp-lifecycle.cjs
```

La prueba ejecuta los controladores y servicios compilados con transportes y persistencia simulados. Verifica 300 respuestas automáticas, sus notificaciones y estados de citas, reconocimiento de respuestas escritas, plantillas de recordatorio con horario y envío al representante, mensajes manuales con adjuntos y alternativa por Twilio, confirmaciones de lectura, 500 reconexiones consecutivas, espera progresiva, eventos obsoletos, desconexión durante autenticación, recuperación de cifrado y cierre de sesión. Comprueba que nunca haya dos sockets activos y que listeners y temporizadores no se acumulen. No envía mensajes reales ni utiliza datos o credenciales de producción.

## Publicación y seguimiento

Esta corrección no cambia el esquema de la base de datos, las plantillas, los horarios de los cron ni las variables de Railway. Se publica como actualización del backend existente. No requiere una migración de pacientes, mensajes o sesiones ni una revinculación planificada de WhatsApp.

Tras publicar, verificar en la app una confirmación, cancelación y solicitud de reagendamiento, un recordatorio y un mensaje manual; observar memoria, errores 5xx y reconexiones durante al menos 48 horas. Las pruebas simuladas no demuestran por sí solas estabilidad sostenida de la biblioteca WhatsApp en producción. El aumento continuo de memoria o nuevas advertencias de listeners requieren ampliar el diagnóstico con métricas de heap y un perfil de memoria.

Para revertir el código, restaurar la versión anterior del backend; esta corrección no introduce cambios de datos que deban deshacerse. Separar WhatsApp en otro servicio y añadir monitoreo externo siguen siendo mejoras independientes de infraestructura.
