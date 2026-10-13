-- Additive: preserve existing users, payment dates and historical expense rows.
ALTER TABLE "inventa_clinical_app"."users"
    ADD COLUMN IF NOT EXISTS "session_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inventa_clinical_app"."costs"
    ADD COLUMN IF NOT EXISTS "recurring_period" VARCHAR(7);
-- Legacy rows retain NULL and their original month assignment; no guessed backfill.
CREATE UNIQUE INDEX IF NOT EXISTS "costs_recurring_parent_id_recurring_period_key"
    ON "inventa_clinical_app"."costs"("recurring_parent_id", "recurring_period");
