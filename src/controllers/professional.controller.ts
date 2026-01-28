import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { sendWelcomeEmail, generateSecurePassword } from '../lib/email';

const scheduleItemSchema = z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    days: z.array(z.number()),
    branchId: z.string().optional(),
    active: z.boolean().optional()
});

const professionalSchema = z.object({
    firstName: z.string().min(1, "Nombre requerido"),
    lastName: z.string().min(1, "Apellido requerido"),
    specialty: z.string().min(1, "Especialidad requerida"),
    registrationNumber: z.string().min(1, "Registro requerido"),
    email: z.string().email("Email inválido"),
    phone: z.string().optional(),
    color: z.string().min(1, "Color requerido"),
    status: z.enum(['active', 'inactive']).default('active'),
    gender: z.string().optional(),
    prefix: z.string().optional(),
    workingHours: z.union([
        scheduleItemSchema,
        z.array(scheduleItemSchema)
    ]).optional(),
    createUser: z.boolean().optional(),
    prescriptionHeader: z.object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        details: z.string().optional()
    }).optional().nullable(),
});

export const getProfessionals = async (req: Request, res: Response) => {
    try {
        const professionals = await prisma.professional.findMany({
            orderBy: { lastName: 'asc' },
            include: { user: true }
        });
        res.json(professionals);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener profesionales' });
    }
};

export const createProfessional = async (req: Request, res: Response) => {
    try {
        const data = professionalSchema.parse(req.body);
        console.log('Creating Professional:', data);

        const { professional, createdUserCreds } = await prisma.$transaction(async (tx) => {
            let userId: string;
            let tempCreds = null;

            // 1. Check or Create User
            const existingUser = await tx.user.findUnique({ where: { email: data.email } });

            if (existingUser) {
                userId = existingUser.id;
                // Reactivate user if they were inactive?
                if (data.status === 'active' && !existingUser.isActive) {
                    await tx.user.update({ where: { id: userId }, data: { isActive: true } });
                }
            } else {
                const generatedPassword = generateSecurePassword();
                const hashedPassword = await bcrypt.hash(generatedPassword, 10);

                const baseUsername = `${data.firstName.toLowerCase()}.${data.lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
                const username = `${baseUsername}.${Math.floor(Math.random() * 1000)}`;

                const newUser = await tx.user.create({
                    data: {
                        email: data.email,
                        username: username,
                        passwordHash: hashedPassword,
                        fullName: `${data.firstName} ${data.lastName}`,
                        phone: data.phone,
                        role: Role.PROFESSIONAL,
                        isActive: data.status === 'active'
                    }
                });
                userId = newUser.id;

                if (data.createUser) {
                    tempCreds = {
                        email: newUser.email,
                        name: newUser.fullName,
                        username: username,
                        tempPass: generatedPassword
                    };
                }
            }

            // 2. Create Professional Record
            const professional = await tx.professional.create({
                data: {
                    userId: userId,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    specialty: data.specialty,
                    registrationNumber: data.registrationNumber,
                    email: data.email,
                    phone: data.phone,
                    color: data.color,
                    status: data.status,
                    gender: data.gender,
                    prefix: data.prefix,
                    workingHours: data.workingHours ? JSON.parse(JSON.stringify(data.workingHours)) : undefined,
                    prescriptionHeader: data.prescriptionHeader ? JSON.parse(JSON.stringify(data.prescriptionHeader)) : undefined,
                    isActive: data.status === 'active'
                }
            });

            return { professional, createdUserCreds: tempCreds };
        });

        // Send Email OUTSIDE transaction
        if (createdUserCreds) {
            console.log(`Sending welcome email to ${createdUserCreds.email}...`);
            await sendWelcomeEmail(
                createdUserCreds.email,
                createdUserCreds.name,
                createdUserCreds.username,
                createdUserCreds.tempPass
            );
        }

        res.status(201).json(professional);


    } catch (error) {
        console.error(error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: (error as any).errors });
        }
        res.status(500).json({ error: 'Error al crear profesional' });
    }
};

export const updateProfessional = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const data = professionalSchema.partial().parse(req.body);

        const professional = await prisma.$transaction(async (tx) => {
            const updatedPro = await tx.professional.update({
                where: { id },
                data: {
                    firstName: data.firstName,
                    lastName: data.lastName,
                    specialty: data.specialty,
                    registrationNumber: data.registrationNumber,
                    email: data.email,
                    phone: data.phone,
                    color: data.color,
                    status: data.status,
                    gender: data.gender,
                    prefix: data.prefix,
                    workingHours: data.workingHours ? JSON.parse(JSON.stringify(data.workingHours)) : undefined,
                    prescriptionHeader: data.prescriptionHeader ? JSON.parse(JSON.stringify(data.prescriptionHeader)) : undefined,
                    isActive: data.status === 'active' // Sync boolean
                }
            });

            // Sync User Status if Professional Status changed
            if (data.status) {
                const isActive = data.status === 'active';
                await tx.user.update({
                    where: { id: updatedPro.userId },
                    data: { isActive: isActive }
                });
            }

            return updatedPro;
        });

        res.json(professional);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar profesional' });
    }
};

export const deleteProfessional = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        await prisma.professional.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar profesional' });
    }
};
