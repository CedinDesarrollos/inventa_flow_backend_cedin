# Arranque y migraciones

`npm start` solo ejecuta el servidor compilado. No sincroniza el esquema ni ejecuta migraciones.
`npm run build` y `postinstall` generan el cliente Prisma; instalar las devDependencies en la fase de build para disponer de Prisma CLI y TypeScript.
El servidor exige `JWT_SECRET` y `DATABASE_URL`. La base debe estar preparada antes de usar rutas con datos.

## Comandos

- `npm run db:status`: consulta el historial de migraciones.
- `npm run db:diff`: compara la base de `DATABASE_URL` con el esquema actual sin escribir datos. Exit 0: coinciden; exit 2: diferencias; exit 1: error.
- `npm run db:migrate`: aplica las migraciones versionadas explícitamente. Rechaza un esquema clínico existente sin baseline verificada.
- `npm run db:baseline`: para una base existente que ya coincide con el esquema, registra la migración inicial como aplicada sin ejecutar su SQL de creación. Primero compara esquemas y rechaza diferencias o errores.

Los comandos usan la conexión configurada; no imprimirla ni guardar credenciales en el repositorio. No agregar `db:migrate` al arranque o al predeploy de Railway antes de verificar la base destino.

## Base vacía

Revisar `prisma/migrations/20261011000000_baseline/migration.sql`, luego ejecutar `npm run db:migrate` sobre la base vacía destinada a la aplicación. Verificar `db:status` y `db:diff`.
La baseline incluye el esquema completo actual, no los datos iniciales. Crear el primer administrador mediante un procedimiento local controlado; `/api/auth/register` ahora requiere un ADMIN o DEVELOPER autenticado.

## Base existente

1. Confirmar base, entorno y servicio. Preparar y probar la restauración de un backup; usar una copia aislada para el ensayo.
2. Ejecutar `npm run db:diff` y revisar `npm run db:status`. Un historial ausente es esperable en una instalación que usaba db push.
3. Si hay diferencias, detenerse. Preparar SQL incremental revisado para reconciliarlas y ensayarlo sobre la copia. No aplicar la baseline completa sobre tablas existentes ni usar `--accept-data-loss`. El diff de Prisma no cubre todos los objetos PostgreSQL: revisar también triggers, vistas, extensiones, permisos y SQL manual de la instalación.
4. Solo si el esquema coincide y el historial previo se revisó, ejecutar `npm run db:baseline` sobre la copia. Registra la baseline en `_prisma_migrations`; no recrea las tablas ni carga datos.
5. Ejecutar `db:status`, `db:diff` y `db:migrate` en la copia, confirmar que no cambia datos y hacer las pruebas de integración.
6. Presentar los resultados y el plan de recuperación antes de repetir el proceso en producción. Registrar una baseline escribe metadatos de migración y también requiere elegir deliberadamente la base destino.

La base de producción no fue inspeccionada ni modificada durante esta corrección. Esta baseline refleja el esquema del repositorio; no certifica que coincida con producción.

## Cambios futuros

Crear cada migración desde una base de desarrollo aislada con baseline, revisar el SQL y versionar una carpeta nueva bajo `prisma/migrations`. No editar migraciones ya aplicadas. Probar instalación desde cero y actualización con datos antes de aplicar en un entorno compartido.
Los SQL manuales históricos se conservan en `prisma/manual-migrations`; los scripts anteriores apuntan a esa ubicación, pero no deben usarse como parte del nuevo proceso automático. Contienen diferencias históricas y datos iniciales que requieren revisión independiente.

Un rollback de código no revierte SQL. Priorizar cambios compatibles con la versión anterior; ante una migración fallida, inspeccionar el estado y elegir reparación o restauración. No ejecutar comandos `resolve` a ciegas.

## Validación local

`npm test` compila y ejecuta las regresiones HTTP con Prisma simulado, sin enviar notificaciones ni usar una base real.
Para ensayar migraciones, añadir `TEST_DATABASE_URL` apuntando a PostgreSQL local desechable con permiso de crear bases:

```sh
TEST_DATABASE_URL=postgresql://predeploy@127.0.0.1:55432/predeploy npm test
```

Las pruebas de integración de citas y migraciones crean bases propias, comprueba migración inicial e idempotencia, rechaza aplicar sobre una base existente sin baseline y rechaza drift; registra la baseline sobre un esquema coincidente y verifica que conserva un registro sintético. Eliminan únicamente las bases que crearon. La prueba de citas usa un adaptador PostgreSQL local explícito y datos sintéticos; la configuración TLS de producción no se modifica. También se prueba npm start y el reinicio con una conexión inaccesible y crons desactivados, para demostrar que el arranque no depende de aplicar SQL.
