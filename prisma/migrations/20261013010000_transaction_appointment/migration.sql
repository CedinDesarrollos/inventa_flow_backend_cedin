-- Nullable and additive: historical transactions remain unlinked; do not guess.
ALTER TABLE "inventa_clinical_app"."transactions"
    ADD COLUMN IF NOT EXISTS "appointment_id" TEXT;

CREATE INDEX IF NOT EXISTS "transactions_appointment_id_idx"
    ON "inventa_clinical_app"."transactions"("appointment_id");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_appointment_id_fkey'
        AND conrelid = 'inventa_clinical_app.transactions'::regclass) THEN
        ALTER TABLE "inventa_clinical_app"."transactions"
            ADD CONSTRAINT "transactions_appointment_id_fkey"
            FOREIGN KEY ("appointment_id") REFERENCES "inventa_clinical_app"."appointments"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
