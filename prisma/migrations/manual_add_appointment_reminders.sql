-- Migration: Add appointment reminders and professional fields
-- Date: 2026-01-21
-- Description: Adds gender/prefix to professionals, creates appointment_reminders table

-- 1. Add gender and prefix fields to professionals table
ALTER TABLE inventa_clinical_app.professionals 
ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
ADD COLUMN IF NOT EXISTS prefix VARCHAR(50);

-- 2. Create appointment_reminders table
CREATE TABLE IF NOT EXISTS inventa_clinical_app.appointment_reminders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id TEXT NOT NULL,
  sent_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending' NOT NULL,
  twilio_message_sid VARCHAR(255),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0 NOT NULL,
  patient_response VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  
  CONSTRAINT fk_appointment_reminder_appointment
    FOREIGN KEY (appointment_id) 
    REFERENCES inventa_clinical_app.appointments(id)
    ON DELETE CASCADE
);

-- 3. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_appointment_reminders_appointment_id 
ON inventa_clinical_app.appointment_reminders(appointment_id);

CREATE INDEX IF NOT EXISTS idx_appointment_reminders_status 
ON inventa_clinical_app.appointment_reminders(status);

-- 4. Insert system settings for reminders (if not exists)
INSERT INTO inventa_clinical_app.system_settings (id, key, value, description)
VALUES 
  (gen_random_uuid(), 'reminder_window_start', '"09:00"', 'Hora de inicio para envío de recordatorios (formato HH:mm)'),
  (gen_random_uuid(), 'reminder_window_end', '"18:00"', 'Hora de fin para envío de recordatorios (formato HH:mm)'),
  (gen_random_uuid(), 'reminder_hours_before', '24', 'Horas de anticipación para enviar recordatorio')
ON CONFLICT (key) DO NOTHING;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE '✅ Added gender and prefix to professionals';
  RAISE NOTICE '✅ Created appointment_reminders table';
  RAISE NOTICE '✅ Added system settings for reminders';
END $$;
