import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

// Schema for Creating a Clinical Record
const clinicalRecordSchema = z.object({
    patientId: z.string().uuid(),
    doctorId: z.string().uuid().optional(),
    content: z.any(), // Rich Text JSON
    vitalSigns: z.any().optional(), // Vital Signs { weight, height, bp, etc. }
    prescriptionItems: z.array(z.object({
        id: z.string().optional(),
        medicationId: z.string().optional(),
        medicationName: z.string(),
        duration: z.string(),
        instructions: z.string(),
    })).optional()
});

export const getClinicalRecords = async (req: Request, res: Response) => {
    try {
        const { patientId } = req.params as { patientId: string };

        // Fetch existing records
        let records = await prisma.clinicalRecord.findMany({
            where: { patientId },
            orderBy: { date: 'desc' },
            include: {
                doctor: {
                    select: {
                        id: true,
                        fullName: true,
                        professional: {
                            select: { specialty: true }
                        }
                    }
                },
                prescriptions: true,
            },
        });

        // If no records exist, create an initial empty record
        if (records.length === 0) {
            console.log(`No clinical records found for patient ${patientId}, creating initial record...`);

            // Verify patient exists before creating record
            const patient = await prisma.patient.findUnique({
                where: { id: patientId }
            });

            if (!patient) {
                return res.status(404).json({ error: 'Paciente no encontrado' });
            }

            // Create initial record with empty content
            const initialRecord = await prisma.clinicalRecord.create({
                data: {
                    patientId,
                    doctorId: null, // System-generated, no specific doctor
                    content: {
                        type: 'doc',
                        content: [{
                            type: 'paragraph',
                            content: [{
                                type: 'text',
                                text: 'Ficha clínica inicializada.'
                            }]
                        }]
                    },
                    date: new Date()
                },
                include: {
                    doctor: {
                        select: {
                            id: true,
                            fullName: true,
                            professional: {
                                select: { specialty: true }
                            }
                        }
                    },
                    prescriptions: true,
                }
            });

            records = [initialRecord];
            console.log(`Initial clinical record created for patient ${patientId}`);
        }

        res.json(records);
    } catch (error) {
        console.error('Error fetching clinical records:', error);
        res.status(500).json({ error: 'Error al obtener historial clínico' });
    }
};

export const createClinicalRecord = async (req: Request, res: Response) => {
    try {
        const data = clinicalRecordSchema.parse(req.body);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create the Record
            const record = await tx.clinicalRecord.create({
                data: {
                    patientId: data.patientId,
                    doctorId: data.doctorId,
                    content: data.content,
                    vitalSigns: data.vitalSigns,
                    date: new Date(),
                }
            });

            // 2. Create Prescription if items exist
            let prescription = null;
            if (data.prescriptionItems && data.prescriptionItems.length > 0) {
                prescription = await tx.prescription.create({
                    data: {
                        patientId: data.patientId,
                        clinicalRecordId: record.id,
                        medications: data.prescriptionItems
                    }
                });
            }

            return { record, prescription };
        });

        res.status(201).json(result);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: (error as any).errors });
        }
        console.error('Error creating clinical record:', error);
        res.status(500).json({ error: 'Error al guardar ficha clínica' });
    }
};
