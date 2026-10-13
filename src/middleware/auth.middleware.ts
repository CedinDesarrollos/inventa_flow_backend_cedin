import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        role: string;
        email: string;
    };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    // Skip auth for OPTIONS (CORS preflight)
    if (req.method === 'OPTIONS') {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        console.warn(`[AUTH] Missing token for ${req.method} ${req.originalUrl}`);
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, JWT_SECRET, async (err: any, user: any) => {
        if (err) {
            console.error('[AUTH] JWT Verification Error:', err.message);
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        if (!user || typeof user !== 'object' || typeof user.userId !== 'string' || !user.userId || typeof user.role !== 'string') {
            return res.status(401).json({ message: 'Invalid token payload' });
        }
        try {
            const account = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { id: true, role: true, email: true, isActive: true, sessionVersion: true }
            });
            // Tokens issued before session-version support remain valid only at version zero.
            if (!account?.isActive || (user.sessionVersion ?? 0) !== account.sessionVersion) {
                return res.status(401).json({ message: 'La cuenta está inactiva o la sesión fue revocada' });
            }
            req.user = { userId: account.id, role: account.role, email: account.email };
            next();
        } catch (error) {
            console.error('Account access verification failed');
            return res.status(503).json({ message: 'No se pudo verificar el acceso. Intente nuevamente.' });
        }
    });
};

export const requireRole = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Insufficient permissions' });
        }
        next();
    };
};
