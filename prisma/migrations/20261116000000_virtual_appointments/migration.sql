-- Additive and idempotent: new columns with safe defaults; existing rows are untouched.
ALTER TABLE "inventa_clinical_app"."appointments" ADD COLUMN IF NOT EXISTS "is_virtual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventa_clinical_app"."professionals" ADD COLUMN IF NOT EXISTS "special_slots" JSONB;
