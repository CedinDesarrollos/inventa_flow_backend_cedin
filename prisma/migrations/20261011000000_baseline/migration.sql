-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventa_clinical_app";

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."Role" AS ENUM ('ADMIN', 'PROFESSIONAL', 'SECRETARY', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."AppointmentType" AS ENUM ('CONSULTATION', 'FOLLOW_UP', 'PROCEDURE');

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'IN_PROGRESS', 'BILLED', 'ARRIVED');

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."PaymentStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'REFUNDED');

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."TransactionType" AS ENUM ('TICKET', 'INVOICE');

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."PaymentMethod" AS ENUM ('CASH', 'CARD', 'INSURANCE', 'MIXED');

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."TransactionStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "inventa_clinical_app"."VisitStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "inventa_clinical_app"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "rut" TEXT,
    "password_hash" TEXT NOT NULL,
    "pin_hash" TEXT,
    "full_name" TEXT NOT NULL,
    "role" "inventa_clinical_app"."Role" NOT NULL DEFAULT 'PROFESSIONAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "must_change_pin" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."professionals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "color" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "working_hours" JSONB,
    "integrations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "gender" TEXT,
    "prefix" TEXT,
    "prescription_header" JSONB,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "exhibit_color" TEXT NOT NULL,
    "rooms_count" INTEGER NOT NULL DEFAULT 0,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."patients" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "birth_date" TIMESTAMP(3),
    "address" TEXT,
    "insurance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "branch_id" TEXT,
    "gender" TEXT,
    "medical_history" JSONB,
    "lid" TEXT,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."patient_relationships" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "relative_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "receives_notifications" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."services" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."insurances" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruc" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "coverage_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "requires_auth" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "insurances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."tariffs" (
    "id" TEXT NOT NULL,
    "insurance_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "coverage_type" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "professional_id" TEXT,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."appointments" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "type" "inventa_clinical_app"."AppointmentType" NOT NULL,
    "status" "inventa_clinical_app"."AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "branch_id" TEXT,
    "end_date" TIMESTAMP(3),
    "google_event_id" TEXT,
    "outlook_event_id" TEXT,
    "service_id" TEXT,
    "external_id" TEXT,
    "legacy_tipo_reserva" TEXT,
    "secretary_note" TEXT,
    "payment_status" "inventa_clinical_app"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "is_overbooking" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."appointment_reminders" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "twilio_message_sid" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "patient_response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."notification_logs" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."professional_schedules" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "professional_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."clinical_records" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doctor_id" TEXT,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "vital_signs" JSONB,

    CONSTRAINT "clinical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."prescriptions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "clinical_record_id" TEXT,
    "medications" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."patient_tags" (
    "patient_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "patient_tags_pkey" PRIMARY KEY ("patient_id","tag_id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."clinical_templates" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "clinical_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."medication_catalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_dose" TEXT,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."transactions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "author_id" TEXT,
    "type" "inventa_clinical_app"."TransactionType" NOT NULL,
    "status" "inventa_clinical_app"."TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "payment_method" "inventa_clinical_app"."PaymentMethod" NOT NULL,
    "payment_code" TEXT,
    "payment_receipt_url" TEXT,
    "billing_ruc" TEXT,
    "billing_name" TEXT,
    "billing_address" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "savings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "amount_paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "doctor_id" TEXT,
    "exonerated_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "observation" TEXT,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."transaction_items" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "service_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "coverage" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "copay" DECIMAL(10,2) NOT NULL,
    "custom_description" TEXT,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."payments" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "inventa_clinical_app"."PaymentMethod" NOT NULL,
    "payment_code" TEXT,
    "receipt_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

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
    "completed_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),

    CONSTRAINT "medical_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."conversations" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "status" TEXT NOT NULL DEFAULT 'open',
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."conversation_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "sender" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "media_url" TEXT,
    "media_type" TEXT,
    "media_size" INTEGER,
    "external_id" TEXT,
    "external_url" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "from_number" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "to_number" TEXT,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."conversation_tags" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."automation_campaigns" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."nps_responses" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "patient_phone" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SCORE',
    "expires_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score_received_at" TIMESTAMP(3),
    "comment_received_at" TIMESTAMP(3),

    CONSTRAINT "nps_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."cash_closes" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" TEXT NOT NULL,
    "branch_id" TEXT,
    "total_cash" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_card" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_insurance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "signatures" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'ALL_DAY',

    CONSTRAINT "cash_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."baileys_sessions" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baileys_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."cost_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."costs" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence_rule" TEXT,
    "recurring_parent_id" TEXT,
    "branch_id" TEXT,
    "receipt_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "description" TEXT,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER NOT NULL DEFAULT 5,
    "unit" TEXT NOT NULL DEFAULT 'units',
    "cost_price" DECIMAL(10,2),
    "sale_price" DECIMAL(10,2),
    "branch_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."inventory_movements" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "cost_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "link" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventa_clinical_app"."_InsuranceToProfessional" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_InsuranceToProfessional_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "inventa_clinical_app"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "inventa_clinical_app"."users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_rut_key" ON "inventa_clinical_app"."users"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_user_id_key" ON "inventa_clinical_app"."professionals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_identifier_key" ON "inventa_clinical_app"."patients"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "patients_lid_key" ON "inventa_clinical_app"."patients"("lid");

-- CreateIndex
CREATE UNIQUE INDEX "patient_relationships_patient_id_relative_id_key" ON "inventa_clinical_app"."patient_relationships"("patient_id", "relative_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "inventa_clinical_app"."services"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tariffs_insurance_id_service_id_professional_id_key" ON "inventa_clinical_app"."tariffs"("insurance_id", "service_id", "professional_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "inventa_clinical_app"."tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "inventa_clinical_app"."system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "medication_catalog_name_key" ON "inventa_clinical_app"."medication_catalog"("name");

-- CreateIndex
CREATE INDEX "medical_visits_branch_id_idx" ON "inventa_clinical_app"."medical_visits"("branch_id");

-- CreateIndex
CREATE INDEX "medical_visits_professional_id_idx" ON "inventa_clinical_app"."medical_visits"("professional_id");

-- CreateIndex
CREATE INDEX "medical_visits_status_idx" ON "inventa_clinical_app"."medical_visits"("status");

-- CreateIndex
CREATE INDEX "medical_visits_created_at_idx" ON "inventa_clinical_app"."medical_visits"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_campaigns_key_key" ON "inventa_clinical_app"."automation_campaigns"("key");

-- CreateIndex
CREATE UNIQUE INDEX "nps_responses_appointment_id_key" ON "inventa_clinical_app"."nps_responses"("appointment_id");

-- CreateIndex
CREATE INDEX "nps_responses_patient_phone_status_idx" ON "inventa_clinical_app"."nps_responses"("patient_phone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cost_categories_name_key" ON "inventa_clinical_app"."cost_categories"("name");

-- CreateIndex
CREATE INDEX "costs_date_idx" ON "inventa_clinical_app"."costs"("date");

-- CreateIndex
CREATE INDEX "costs_category_id_idx" ON "inventa_clinical_app"."costs"("category_id");

-- CreateIndex
CREATE INDEX "costs_branch_id_idx" ON "inventa_clinical_app"."costs"("branch_id");

-- CreateIndex
CREATE INDEX "costs_recurring_parent_id_idx" ON "inventa_clinical_app"."costs"("recurring_parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "inventa_clinical_app"."products"("sku");

-- CreateIndex
CREATE INDEX "_InsuranceToProfessional_B_index" ON "inventa_clinical_app"."_InsuranceToProfessional"("B");

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."professionals" ADD CONSTRAINT "professionals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."patients" ADD CONSTRAINT "patients_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."patients" ADD CONSTRAINT "patients_insurance_id_fkey" FOREIGN KEY ("insurance_id") REFERENCES "inventa_clinical_app"."insurances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."patient_relationships" ADD CONSTRAINT "patient_relationships_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."patient_relationships" ADD CONSTRAINT "patient_relationships_relative_id_fkey" FOREIGN KEY ("relative_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."tariffs" ADD CONSTRAINT "tariffs_insurance_id_fkey" FOREIGN KEY ("insurance_id") REFERENCES "inventa_clinical_app"."insurances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."tariffs" ADD CONSTRAINT "tariffs_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "inventa_clinical_app"."professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."tariffs" ADD CONSTRAINT "tariffs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "inventa_clinical_app"."services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."appointments" ADD CONSTRAINT "appointments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "inventa_clinical_app"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."appointment_reminders" ADD CONSTRAINT "appointment_reminders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "inventa_clinical_app"."appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."professional_schedules" ADD CONSTRAINT "professional_schedules_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."clinical_records" ADD CONSTRAINT "clinical_records_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."clinical_records" ADD CONSTRAINT "clinical_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."prescriptions" ADD CONSTRAINT "prescriptions_clinical_record_id_fkey" FOREIGN KEY ("clinical_record_id") REFERENCES "inventa_clinical_app"."clinical_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."prescriptions" ADD CONSTRAINT "prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."patient_tags" ADD CONSTRAINT "patient_tags_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."patient_tags" ADD CONSTRAINT "patient_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "inventa_clinical_app"."tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."clinical_templates" ADD CONSTRAINT "clinical_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."transactions" ADD CONSTRAINT "transactions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."transactions" ADD CONSTRAINT "transactions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."transactions" ADD CONSTRAINT "transactions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."transaction_items" ADD CONSTRAINT "transaction_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "inventa_clinical_app"."services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "inventa_clinical_app"."transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."payments" ADD CONSTRAINT "payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "inventa_clinical_app"."transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."medical_visits" ADD CONSTRAINT "medical_visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."medical_visits" ADD CONSTRAINT "medical_visits_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."conversations" ADD CONSTRAINT "conversations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "inventa_clinical_app"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "inventa_clinical_app"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."conversation_messages" ADD CONSTRAINT "conversation_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "inventa_clinical_app"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."nps_responses" ADD CONSTRAINT "nps_responses_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "inventa_clinical_app"."appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."cash_closes" ADD CONSTRAINT "cash_closes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."cash_closes" ADD CONSTRAINT "cash_closes_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."costs" ADD CONSTRAINT "costs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."costs" ADD CONSTRAINT "costs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventa_clinical_app"."cost_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."costs" ADD CONSTRAINT "costs_recurring_parent_id_fkey" FOREIGN KEY ("recurring_parent_id") REFERENCES "inventa_clinical_app"."costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."products" ADD CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventa_clinical_app"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."inventory_movements" ADD CONSTRAINT "inventory_movements_cost_id_fkey" FOREIGN KEY ("cost_id") REFERENCES "inventa_clinical_app"."costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "inventa_clinical_app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."_InsuranceToProfessional" ADD CONSTRAINT "_InsuranceToProfessional_A_fkey" FOREIGN KEY ("A") REFERENCES "inventa_clinical_app"."insurances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventa_clinical_app"."_InsuranceToProfessional" ADD CONSTRAINT "_InsuranceToProfessional_B_fkey" FOREIGN KEY ("B") REFERENCES "inventa_clinical_app"."professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
