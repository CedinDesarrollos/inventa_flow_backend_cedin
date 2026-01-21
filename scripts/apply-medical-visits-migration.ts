import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('Applying medical_visits migration...');

    try {
        // Create enum
        await prisma.$executeRawUnsafe(`
      CREATE TYPE "inventa_clinical_app"."VisitStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED');
    `);
        console.log('✓ Created VisitStatus enum');
    } catch (error: any) {
        if (error.code === '42710') {
            console.log('✓ VisitStatus enum already exists');
        } else {
            throw error;
        }
    }

    try {
        // Create table
        await prisma.$executeRawUnsafe(`
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
    `);
        console.log('✓ Created medical_visits table');
    } catch (error: any) {
        if (error.code === '42P07') {
            console.log('✓ medical_visits table already exists');
        } else {
            throw error;
        }
    }

    // Create indexes
    try {
        await prisma.$executeRawUnsafe(`CREATE INDEX "medical_visits_branch_id_idx" ON "inventa_clinical_app"."medical_visits"("branch_id");`);
        console.log('✓ Created branch_id index');
    } catch (error: any) {
        if (error.code === '42P07') console.log('✓ branch_id index already exists');
    }

    try {
        await prisma.$executeRawUnsafe(`CREATE INDEX "medical_visits_professional_id_idx" ON "inventa_clinical_app"."medical_visits"("professional_id");`);
        console.log('✓ Created professional_id index');
    } catch (error: any) {
        if (error.code === '42P07') console.log('✓ professional_id index already exists');
    }

    try {
        await prisma.$executeRawUnsafe(`CREATE INDEX "medical_visits_status_idx" ON "inventa_clinical_app"."medical_visits"("status");`);
        console.log('✓ Created status index');
    } catch (error: any) {
        if (error.code === '42P07') console.log('✓ status index already exists');
    }

    try {
        await prisma.$executeRawUnsafe(`CREATE INDEX "medical_visits_created_at_idx" ON "inventa_clinical_app"."medical_visits"("created_at");`);
        console.log('✓ Created created_at index');
    } catch (error: any) {
        if (error.code === '42P07') console.log('✓ created_at index already exists');
    }

    // Add foreign keys
    try {
        await prisma.$executeRawUnsafe(`
      ALTER TABLE "inventa_clinical_app"."medical_visits" 
      ADD CONSTRAINT "medical_visits_branch_id_fkey" 
      FOREIGN KEY ("branch_id") REFERENCES "inventa_clinical_app"."branches"("id") 
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
        console.log('✓ Created branch foreign key');
    } catch (error: any) {
        if (error.code === '42710') console.log('✓ branch foreign key already exists');
    }

    try {
        await prisma.$executeRawUnsafe(`
      ALTER TABLE "inventa_clinical_app"."medical_visits" 
      ADD CONSTRAINT "medical_visits_professional_id_fkey" 
      FOREIGN KEY ("professional_id") REFERENCES "inventa_clinical_app"."users"("id") 
      ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
        console.log('✓ Created professional foreign key');
    } catch (error: any) {
        if (error.code === '42710') console.log('✓ professional foreign key already exists');
    }

    console.log('\n✅ Migration completed successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
