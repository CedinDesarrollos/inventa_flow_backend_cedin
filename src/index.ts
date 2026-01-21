import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { prisma } from './lib/prisma';
import authRoutes from './routes/auth.routes';
import branchRoutes from './routes/branch.routes';
import professionalRoutes from './routes/professional.routes';
import insuranceRoutes from './routes/insurance.routes';
import patientRoutes from './routes/patient.routes';
import userRoutes from './routes/user.routes';
import systemSettingsRoutes from './routes/system-settings.routes';
import tagRoutes from './routes/tag.routes';
import templateRoutes from './routes/template.routes';
import serviceRoutes from './routes/service.routes';
import tariffRoutes from './routes/tariff.routes';
import appointmentRoutes from './routes/appointment.routes';
import availabilityRoutes from './routes/availability.routes';
import path from 'path'; // Need path module
import clinicalRecordRoutes from './routes/clinical-record.routes';
import uploadRoutes from './routes/upload.routes';
import transactionRoutes from './routes/transaction.routes';
import medicalVisitRoutes from './routes/medical-visit.routes';
import reportsRoutes from './routes/reports.routes';
import conversationRoutes from './routes/conversation.routes';
import webhookRoutes from './routes/webhook.routes';

// ... (existing imports)

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" } // Allow loading images from different origin/port
}));
app.use(cors({
    origin: (origin, callback) => {
        const allowed = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim());
        if (!origin || allowed.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`Blocked by CORS: ${origin}. Allowed: ${allowed.join(', ')}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve Static Files (Uploads)
const defaultUploadDir = path.join(__dirname, '../public/uploads');
const uploadDir = process.env.UPLOAD_DIR || defaultUploadDir;

app.use('/uploads', express.static(uploadDir));

// DEBUG: Log all requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/professionals', professionalRoutes);
app.use('/api/insurances', insuranceRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/users', userRoutes);
app.use('/api/system-settings', systemSettingsRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/tariffs', tariffRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reports', reportsRoutes);
console.log('Registering /api/appointments routes...');
app.use('/api/appointments', appointmentRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/clinical-records', clinicalRecordRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/medical-visits', medicalVisitRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/webhooks', webhookRoutes);

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database Check
app.get('/api/db-check', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'connected', database: 'PostgreSQL' });
    } catch (error) {
        console.error('Database connection failed:', error);
        res.status(500).json({ status: 'error', message: 'Database connection failed' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    process.exit(0);
});
