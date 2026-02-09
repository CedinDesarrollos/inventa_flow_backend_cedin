import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('Adding MIXED to PaymentMethod enum...');
    try {
        // Attempt to add the value. 
        await prisma.$executeRawUnsafe(`ALTER TYPE "inventa_clinical_app"."PaymentMethod" ADD VALUE IF NOT EXISTS 'MIXED';`);
        console.log('Successfully added MIXED to PaymentMethod.');
    } catch (error: any) {
        if (error.message.includes('already exists')) {
            console.log('Value MIXED already exists in PaymentMethod.');
        } else {
            // Fallback or just log error
            console.error('Error adding enum value:', error.message);
            try {
                await prisma.$executeRawUnsafe(`ALTER TYPE "inventa_clinical_app"."PaymentMethod" ADD VALUE 'MIXED';`);
                console.log('Successfully added MIXED to PaymentMethod (retry).');
            } catch (innerError: any) {
                if (innerError.message.includes('already exists')) {
                    console.log('Value MIXED already exists in PaymentMethod (retry).');
                } else {
                    console.error('Retry failed:', innerError.message);
                }
            }
        }
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
