import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Validation Schemas
const passwordSchema = z.string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una minúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número')
    .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un carácter especial');

const registerSchema = z.object({
    email: z.string().email(),
    password: passwordSchema,
    fullName: z.string().min(2),
    username: z.string().optional(),
    rut: z.string().optional(),
    role: z.enum(['ADMIN', 'PROFESSIONAL', 'SECRETARY', 'DEVELOPER']).optional()
});

const loginSchema = z.object({
    identifier: z.string(),
    password: z.string(),
    rememberMe: z.boolean().optional()
});


export const register = async (req: Request, res: Response) => {
    try {
        const { email, password, fullName, username, rut, role } = registerSchema.parse(req.body);

        // Check if user exists with any of the identifiers
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { email },
                    ...(username ? [{ username }] : []),
                    ...(rut ? [{ rut }] : [])
                ]
            }
        });

        if (existingUser) {
            return res.status(400).json({ message: 'User already exists (Email, Username, or RUT)' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                username,
                rut,
                passwordHash: hashedPassword,
                fullName,
                role: role || 'PROFESSIONAL'
            }
        });

        // Don't return password hash
        const { passwordHash: _, ...userWithoutPassword } = user;

        res.status(201).json(userWithoutPassword);
    } catch (error) {
        console.error('Registration Error:', error);
        if (error instanceof z.ZodError) {
            // Explicitly cast to ZodError to satisfy TS
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { identifier, password, rememberMe } = loginSchema.parse(req.body);

        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: identifier },
                    { username: identifier },
                    { rut: identifier }
                ]
            }
        });

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: rememberMe ? '12h' : '4h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                fullName: user.fullName,
                role: user.role,
                mustChangePassword: user.mustChangePassword
            }
        });
    } catch (error) {
        console.error('Login Error:', error);
        if (error instanceof z.ZodError) {
            // Explicitly cast to ZodError to satisfy TS
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const forgotPassword = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email requerido' });

        const user = await prisma.user.findUnique({ where: { email } });
        // Security: Always return success even if user not found to prevent enumeration
        if (!user) return res.json({ message: 'Si el email existe, se enviarán instrucciones.' });

        const token = jwt.sign(
            { userId: user.id, type: 'reset' },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;

        // Send email
        await import('../lib/email').then(m => m.sendPasswordResetEmail(user.email, user.fullName, resetUrl));

        res.json({ message: 'Si el email existe, se enviarán instrucciones.' });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

const resetPasswordSchema = z.object({
    token: z.string(),
    newPassword: passwordSchema
});

export const resetPassword = async (req: Request, res: Response) => {
    try {
        const { token, newPassword } = resetPasswordSchema.parse(req.body);

        // Verify token
        const payload = jwt.verify(token, JWT_SECRET) as any;
        if (!payload.userId || payload.type !== 'reset') {
            return res.status(400).json({ message: 'Token inválido o expirado' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: payload.userId },
            data: { passwordHash: hashedPassword }
        });

        res.json({ message: 'Contraseña actualizada exitosamente' });
    } catch (error) {
        console.error('Reset Password Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(400).json({ message: 'El enlace ha expirado. Solicita uno nuevo.' });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

const changePasswordSchema = z.object({
    currentPassword: z.string(),
    newPassword: passwordSchema
});

export const changePassword = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValidPassword) {
            return res.status(400).json({ message: 'Contraseña actual incorrecta' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: userId },
            data: {
                passwordHash: hashedPassword,
                mustChangePassword: false
            }
        });

        res.json({ message: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Change Password Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};
