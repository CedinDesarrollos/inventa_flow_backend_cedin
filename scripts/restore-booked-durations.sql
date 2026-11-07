-- Restaura la duración agendada de citas atendidas cuya duración fue reemplazada
-- por el tiempo real de atención (bug previo al fix de este PR).
-- Usa la duración estándar del servicio; las citas sin servicio quedan como están.
-- 1) Vista previa (solo lectura):
SELECT a.id, a.date, a.duration AS duracion_actual, s.duration_minutes AS duracion_servicio
FROM inventa_clinical_app.appointments a
JOIN inventa_clinical_app.services s ON s.id = a.service_id
WHERE a.status IN ('COMPLETED', 'BILLED') AND a.started_at IS NOT NULL
  AND a.duration <> s.duration_minutes
ORDER BY a.date DESC;

-- 2) Corrección (ejecutar dentro de una transacción tras revisar la vista previa):
-- BEGIN;
-- UPDATE inventa_clinical_app.appointments a
-- SET duration = s.duration_minutes,
--     end_date = a.date + s.duration_minutes * interval '1 minute'
-- FROM inventa_clinical_app.services s
-- WHERE s.id = a.service_id AND a.status IN ('COMPLETED', 'BILLED') AND a.started_at IS NOT NULL
--   AND a.duration <> s.duration_minutes;
-- COMMIT;
