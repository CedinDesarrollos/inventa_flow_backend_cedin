import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads directory exists
const defaultUploadDir = path.join(__dirname, '../../public/uploads');
const uploadDir = process.env.UPLOAD_DIR || defaultUploadDir;

console.log(`Storage directory: ${uploadDir}`);

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename: timestamp-random-originalName
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

// File filter (Images, Docs, Audio, Video)
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    const allowedExtensions = {
        'image/': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
        'audio/': ['.mp3', '.wav', '.ogg'],
        'video/': ['.mp4', '.mov', '.webm'],
        'application/pdf': ['.pdf'],
        'application/msword': ['.doc'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
    };

    const ext = path.extname(file.originalname).toLowerCase();

    // Check MIME type
    let isValidMime = false;
    let allowedExtsForMime: string[] = [];

    if (allowedTypes.includes(file.mimetype)) {
        isValidMime = true;
        // @ts-ignore
        allowedExtsForMime = allowedExtensions[file.mimetype] || [];
    } else if (file.mimetype.startsWith('image/')) {
        isValidMime = true;
        allowedExtsForMime = allowedExtensions['image/'];
    } else if (file.mimetype.startsWith('audio/')) {
        isValidMime = true;
        allowedExtsForMime = allowedExtensions['audio/'];
    } else if (file.mimetype.startsWith('video/')) {
        isValidMime = true;
        allowedExtsForMime = allowedExtensions['video/'];
    }

    if (!isValidMime) {
        return cb(new Error('Tipo de archivo no permitido. Solo imágenes, audio, video, PDF y Word.'));
    }

    // Strict Extension Check
    if (!allowedExtsForMime.includes(ext)) {
        return cb(new Error(`La extensión del archivo (${ext}) no coincide con su tipo (${file.mimetype}).`));
    }

    cb(null, true);
};

export const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB to match global limit
    }
});

export const uploadFile = (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }

        // Construct public URL
        // Priority: PUBLIC_URL (External/Twilio) -> API_URL (Internal) -> Request Host (Dynamic)
        const baseUrl = process.env.PUBLIC_URL || process.env.API_URL || `${req.protocol}://${req.get('host')}`;
        // Note: We will serve 'public/uploads' at '/uploads' endpoint
        const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

        res.json({
            url: fileUrl,
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            size: req.file.size
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: 'Error al subir el archivo' });
    }
};
