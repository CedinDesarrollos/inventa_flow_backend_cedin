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
        const paginated = req.query.page !== undefined || req.query.pageSize !== undefined;
        const { page, pageSize } = z.object({
            page: z.coerce.number().int().min(1).max(1000000).default(1),
            pageSize: z.coerce.number().int().min(1).max(50).default(10)
        }).parse(req.query);
        const include = {
            doctor: { select: { id: true, fullName: true, professional: { select: { specialty: true } } } },
            prescriptions: true
        };
        const total = await prisma.clinicalRecord.count({ where: { patientId } });
        if (!total && !(await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } }))) {
            return res.status(404).json({ error: 'Paciente no encontrado' });
        }
        // Opening or paging a history must not create artificial clinical notes.
        const records = await prisma.clinicalRecord.findMany({
            where: { patientId }, orderBy: [{ date: 'desc' }, { id: 'desc' }], include,
            ...(paginated ? { skip: (page - 1) * pageSize, take: pageSize } : {})
        });
        res.json(paginated ? { records, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } : records);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: 'Paginación inválida' });
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
