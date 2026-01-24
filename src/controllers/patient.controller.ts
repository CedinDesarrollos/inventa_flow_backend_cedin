import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const patientSchema = z.object({
    firstName: z.string().min(1, "Nombre requerido"),
    lastName: z.string().min(1, "Apellido requerido"),
    identifier: z.string().min(1, "Documento/RUT requerido"),
    email: z.string().email("Email inválido").nullable().optional().or(z.literal('')).transform(val => val === '' ? null : val),
    phone: z.string().nullable().optional(),
    birthDate: z.string().nullable().optional().transform(str => str ? new Date(str) : undefined),
    address: z.string().nullable().optional(),
    insuranceId: z.string().nullable().optional().or(z.literal('')).transform(val => val || null),
    branchId: z.string().nullable().optional().or(z.literal('')).transform(val => val || null),
    gender: z.string().nullable().optional(),
    medicalHistory: z.any().optional(), // Flexible JSON
    tags: z.array(z.string()).optional(),
});

export const getPatients = async (req: Request, res: Response) => {
    try {
        const { search, doctorId } = req.query;

        const where: any = {};
        const andConditions: any[] = [];

        if (search) {
            const searchStr = String(search);
            andConditions.push({
                OR: [
                    { firstName: { contains: searchStr, mode: 'insensitive' } },
                    { lastName: { contains: searchStr, mode: 'insensitive' } },
                    { identifier: { contains: searchStr, mode: 'insensitive' } }
                ]
            });
        }

        if (doctorId) {
            andConditions.push({
                OR: [
                    { appointments: { some: { doctorId: String(doctorId) } } },
                    { clinicalRecords: { some: { doctorId: String(doctorId) } } },
                    { transactions: { some: { doctorId: String(doctorId) } } }
                ]
            });
        }

        if (andConditions.length > 0) {
            where.AND = andConditions;
        }

        const patients = await prisma.patient.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                insurance: true,
                tags: {
                    include: { tag: true }
                }
            }
        });
        res.json(patients);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener pacientes' });
    }
};

export const getPatientById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const patient = await prisma.patient.findUnique({
            where: { id },
            include: {
                insurance: true,
                tags: { include: { tag: true } },
                appointments: { orderBy: { date: 'desc' }, take: 5 },
                clinicalRecords: {
                    orderBy: { date: 'desc' },
                    take: 5,
                    include: { doctor: true }
                }
            }
        });
        if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
        res.json(patient);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener paciente' });
    }
}

export const createPatient = async (req: Request, res: Response) => {
    try {
        const data = patientSchema.parse(req.body);
        const { tags, ...patientData } = data;

        // Check duplicate identifier
        const existing = await prisma.patient.findUnique({ where: { identifier: patientData.identifier } });
        if (existing) {
            return res.status(400).json({ error: 'Ya existe un paciente con este Documento/RUT' });
        }

        const patient = await prisma.patient.create({
            data: {
                ...patientData,
                tags: tags ? {
                    create: tags.map(tagId => ({ tagId }))
                } : undefined
            }
        });
        res.status(201).json(patient);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: (error as any).errors });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al crear paciente' });
    }
};

export const updatePatient = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };

        // Use parse, partial() allows undefined fields but we still need transforms for ""
        // However, partial() makes EVERYTHING optional.
        // If we want to allow partial updates, we should use payload.
        // But invalid types (like empty strings for UUIDs) must be transformed.
        // patientSchema.partial() makes all fields optional.
        // The transforms inside patientSchema are attached to the fields.
        // So partial() schema will still run transforms if the field is present?
        // Yes.
        const data = patientSchema.partial().parse(req.body);
        const { tags, ...patientData } = data;

        // Check duplicate identifier if it's being updated
        if (patientData.identifier) {
            const existing = await prisma.patient.findUnique({ where: { identifier: patientData.identifier } });
            if (existing && existing.id !== id) {
                return res.status(400).json({ error: 'Ya existe otro paciente con este Documento/RUT' });
            }
        }

        const patient = await prisma.patient.update({
            where: { id },
            data: {
                ...patientData,
                tags: tags ? {
                    deleteMany: {}, // Remove current tags
                    create: tags.map(tagId => ({ tagId })) // Add new tags
                } : undefined
            }
        });
        res.json(patient);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: (error as any).errors });
        }
        console.error('Error updating patient:', error);
        res.status(500).json({ error: 'Error al actualizar paciente' });
    }
};

export const deletePatient = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        await prisma.patient.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar paciente' });
    }
};

export const mergePatients = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id); // Source ID (Duplicate)
        const targetPatientId = String(req.body.targetPatientId); // Target ID (Real)

        if (!targetPatientId || id === targetPatientId) {
            return res.status(400).json({ error: 'ID de paciente destino inválido' });
        }

        // Use any to bypass local type missing 'lid'
        const source = await prisma.patient.findUnique({ where: { id } }) as any;
        const target = await prisma.patient.findUnique({ where: { id: targetPatientId } }) as any;

        if (!source || !target) {
            return res.status(404).json({ error: 'Paciente no encontrado' });
        }

        await prisma.$transaction(async (tx) => {
            // 1. Transfer Conversations
            await tx.conversation.updateMany({
                where: { patientId: id },
                data: { patientId: targetPatientId }
            });

            // 2. Transfer Appointments
            await tx.appointment.updateMany({
                where: { patientId: id },
                data: { patientId: targetPatientId }
            });

            // 3. Transfer Clinical Records
            await tx.clinicalRecord.updateMany({
                where: { patientId: id },
                data: { patientId: targetPatientId }
            });

            // 4. Transfer Transactions
            await tx.transaction.updateMany({
                where: { patientId: id },
                data: { patientId: targetPatientId }
            });

            // 5. Transfer Prescriptions
            await tx.prescription.updateMany({
                where: { patientId: id },
                data: { patientId: targetPatientId }
            });

            // 6. Transfer Tags
            const sourceTags = await tx.patientTag.findMany({ where: { patientId: id } });
            for (const pt of sourceTags) {
                const existing = await tx.patientTag.findUnique({
                    where: {
                        patientId_tagId: {
                            patientId: targetPatientId,
                            tagId: pt.tagId
                        }
                    }
                });
                if (!existing) {
                    await tx.patientTag.update({
                        where: {
                            patientId_tagId: {
                                patientId: id,
                                tagId: pt.tagId
                            }
                        },
                        data: { patientId: targetPatientId }
                    });
                } else {
                    await tx.patientTag.delete({
                        where: {
                            patientId_tagId: {
                                patientId: id,
                                tagId: pt.tagId
                            }
                        }
                    });
                }
            }

            // 9. Transfer LID logic
            const updateData: any = {};
            if (source.lid) {
                // Remove LID from source first to avoid unique constraint
                await tx.patient.update({ where: { id }, data: { lid: null } as any });
                updateData.lid = source.lid;
            }

            if (Object.keys(updateData).length > 0) {
                await tx.patient.update({
                    where: { id: targetPatientId },
                    data: updateData
                });
            }

            // 10. Delete Source
            await tx.patient.delete({ where: { id } });
        });

        res.json({ success: true, message: 'Pacientes fusionados correctamente' });

    } catch (error) {
        console.error('Error merging patients:', error);
        res.status(500).json({ error: 'Error al fusionar pacientes' });
    }
};
