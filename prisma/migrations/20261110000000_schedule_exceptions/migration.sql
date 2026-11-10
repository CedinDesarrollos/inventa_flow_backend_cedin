-- Additive: new table only. Existing professionals.working_hours stays as the base schedule.
CREATE TABLE IF NOT EXISTS "inventa_clinical_app"."schedule_exceptions" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "branch_id" TEXT,
    "reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "schedule_exceptions_professional_id_date_from_date_to_idx"
    ON "inventa_clinical_app"."schedule_exceptions"("professional_id", "date_from", "date_to");

-- Idempotent: re-running must not fail on existing constraints.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_exceptions_professional_id_fkey') THEN
        ALTER TABLE "inventa_clinical_app"."schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "inventa_clinical_app"."professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_exceptions_branch_id_fkey') THEN
        ALTER TABLE "inventa_clinical_app"."schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_exceptions_created_by_id_fkey') THEN
        ALTER TABLE "inventa_clinical_app"."schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_exceptions_reviewed_by_id_fkey') THEN
        ALTER TABLE "inventa_clinical_app"."schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
