import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { sendWelcomeEmail, generateSecurePassword } from '../lib/email';

const userSchema = z.object({
    fullName: z.string().min(1, "Nombre requerido"),
    email: z.string().email("Email inválido"),
    username: z.string().min(3, "Usuario requerido"),
    rut: z.string().nullable().optional(),
    phone: z.string().optional(),
    role: z.nativeEnum(Role),
    isActive: z.boolean().default(true),
});

export const getUsers = async (req: Request, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { fullName: 'asc' },
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                role: true,
                isActive: true,
                rut: true,
                phone: true,
                createdAt: true,
                // Exclude passwordHash
            }
        });
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
};

export const createUser = async (req: Request, res: Response) => {
    try {
        const data = userSchema.parse(req.body);

        // Check for existing email
        const existingEmail = await prisma.user.findUnique({ where: { email: data.email } });
        if (existingEmail) {
            return res.status(400).json({ error: 'El email ya está registrado.' });
        }

        // Check for existing username
        const existingUsername = await prisma.user.findUnique({ where: { username: data.username } });
        if (existingUsername) {
            return res.status(400).json({ error: `El usuario "${data.username}" ya está en uso. Elige otro.` });
        }

        const generatedPassword = generateSecurePassword();
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);

        const user = await prisma.user.create({
            data: {
                ...data,
                passwordHash: hashedPassword,
                mustChangePassword: true
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                role: true,
                isActive: true,
                phone: true,
                rut: true
            }
        });

        // Send email with credentials
        // Assuming non-null username as we validate it in schema
        if (user.username) {
            console.log(`Sending welcome email to ${user.email}...`);
            await sendWelcomeEmail(user.email, user.fullName, user.username, generatedPassword);
        }

        res.status(201).json(user);

    } catch (error) {
        console.error(error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: (error as any).errors });
        }
        res.status(500).json({ error: 'Error al crear usuario' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const data = userSchema.partial().parse(req.body);

        // Check for collisions if updating email or username
        if (data.email || data.username) {
            const existing = await prisma.user.findFirst({
                where: {
                    AND: [
                        { NOT: { id } }, // Exclude current user
                        {
                            OR: [
                                { email: data.email },
                                { username: data.username }
                            ]
                        }
                    ]
                }
            });

            if (existing) {
                if (existing.email === data.email) return res.status(400).json({ error: 'El email ya está ocupado por otro usuario.' });
                if (existing.username === data.username) return res.status(400).json({ error: `El usuario "${data.username}" ya está ocupado.` });
            }
        }

        const user = await prisma.user.update({
            where: { id },
            data,
            select: { id: true, fullName: true, email: true, username: true, role: true, isActive: true, phone: true, rut: true }
        });

        // If user is a professional, should we sync their professional status?
        // Logic: If User becomes inactive, professional stays "active" in status string but user is locked out. 
        // Or should we sync? For now, User module controls Login access directly.
        if (user.role === Role.PROFESSIONAL && data.isActive !== undefined) {
            // Logic kept simple as per decision
        }

        res.json(user);
    } catch (error) {
        console.error(error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: (error as any).errors });
        }
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        // Check if professional
        const user = await prisma.user.findUnique({ where: { id }, include: { professional: true } });

        if (user?.professional) {
            return res.status(400).json({ error: 'No se puede eliminar un usuario con perfil profesional. Elimine el profesional primero.' });
        }

        await prisma.user.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
};

export const resetPassword = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const generatedPassword = generateSecurePassword();
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);

        await prisma.user.update({
            where: { id },
            data: { passwordHash: hashedPassword }
        });

        if (user.username) {
            await sendWelcomeEmail(user.email, user.fullName, user.username, generatedPassword); // Reuse welcome email or create specific reset one? Welcome works for now.
        }

        res.json({ message: 'Contraseña restablecida y enviada por correo' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al restablecer contraseña' });
    }
};
