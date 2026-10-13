# Comparativo y pagos de gastos

La primera pestaña de Costos muestra el comparativo mensual y debajo sus pagos. Recurrentes conserva la gestión de configuraciones y sus pagos; Inventario conserva productos y movimientos.

GET /api/costs/overview requiere ADMIN/DEVELOPER y startMonth/endMonth (YYYY-MM, hasta 60 meses). Acepta basis=payment|period, origin=individual|recurring|inventory, categoryId, conceptId, search, branchId y page/pageSize. month/detailOrigin acotan solo la tabla tras seleccionar una barra: el comparativo conserva su contexto.

Solo se incluyen costos con isRecurring=false. Las configuraciones recurrentes no son pagos. El origen es exclusivo: recurrente si tiene padre/período, inventario si tiene movimientos vinculados, individual en otro caso. Una compra no suma dos veces. El agrupador de conceptos usa el padre recurrente o categoría/descripción normalizada y origen para otros pagos.

Fecha de pago: America/Asuncion para instantes; los registros heredados a medianoche UTC se tratan como las fechas civiles que guardaba el formulario. Mes correspondiente: recurring_period cuando existe; en recurrentes heredados se conserva el mes UTC del estado anterior; individuales e inventario usan el mes de la fecha registrada. No se mueve ni reescribe ninguna fecha histórica.

Los totales y gráficos usan todos los registros que cumplen los filtros, nunca solo los de la página. La tabla devuelve 25 pagos por defecto, con total de su selección y paginación. Las categorías y conceptos permiten inspeccionar su evolución; el detalle de cada pago muestra categoría, fecha, mes y comprobante. Las compras reflejan el costo vinculado; ajustes de stock sin costo no se presentan como egresos.

GET /api/costs ahora respeta isRecurring (por defecto false). Cuando se filtra por una fecha civil, incluye todo el último día. Los resúmenes de gastos y el reporte financiero excluyen configuraciones recurrentes. El autor del registro individual se guarda con el userId autenticado.

Esta mejora no introduce conciliación bancaria, proveedores, pagos parciales de gastos ni vencimientos nuevos. No requiere migración de esquema. Backend se publica antes del frontend; las verificaciones mínimas cubren totales, periodización, inventario, permisos, último día y clics de gráficos/tabla con datos sintéticos.

Corrección de alcance por sede: includeUnassigned=true (valor predeterminado) agrega los pagos sin branch_id a la sede seleccionada, sin atribuirlos a ella; la interfaz lo muestra como una opción explícita y un aviso con su cantidad/importe. false aplica un filtro estricto de sede. Todas las sedes cuenta cada fila una vez. summary incluye unassignedCount/unassignedTotal para los filtros actuales. El formulario permite elegir/limpiar sede y usa la sede seleccionada para nuevos registros; no reasigna datos históricos automáticamente.
