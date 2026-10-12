-- CreateEnum
CREATE TYPE "inventa_clinical_app"."VisitStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "inventa_clinical_app"."medical_visits" (
    "id" TEXT NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "laboratory" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "notes" TEXT,
    "status" "inventa_clinical_app"."VisitStatus" NOT NULL DEFAULT 'WAITING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medical_visits_branch_id_idx" ON "inventa_clinical_app"."medical_visits"("branch_id");

-- CreateIndex
CREATE INDEX "medical_visits_professional_id_idx" ON "inventa_clinical_app"."medical_visits"("professional_id");

-- CreateIndex
CREATE INDEX "medical_visits_status_idx" ON "inventa_clinical_app"."medical_visits"("status");

-- CreateIndex
CREATE INDEX "medical_visits_created_at_idx" ON "inventa_clinical_app"."medical_visits"("created_at");

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."medical_visits" ADD CONSTRAINT "medical_visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."medical_visits" ADD CONSTRAINT "medical_visits_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
