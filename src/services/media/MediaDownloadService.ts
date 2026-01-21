import axios from 'axios';
import fs from 'fs';
import path from 'path';

export class MediaDownloadService {
    private uploadDir: string;

    constructor() {
        this.uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../../public/uploads');
    }

    /**
     * Downloads multimedia from Twilio and saves it locally
     */
    async downloadTwilioMedia(mediaUrl: string, mediaType: string): Promise<{
        localPath: string;
        publicUrl: string;
        size: number;
    }> {
        const auth = {
            username: process.env.TWILIO_ACCOUNT_SID!,
            password: process.env.TWILIO_AUTH_TOKEN!
        };

        // Download file from Twilio
        const response = await axios.get(mediaUrl, {
            auth,
            responseType: 'arraybuffer'
        });

        // Determine subdirectory and extension
        const subdir = this.getSubdirectory(mediaType);
        const ext = this.getExtension(mediaType);
        const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;

        // Create directory if it doesn't exist
        const fullDir = path.join(this.uploadDir, 'messages', subdir);
        if (!fs.existsSync(fullDir)) {
            fs.mkdirSync(fullDir, { recursive: true });
        }

        // Save file
        const localPath = path.join(fullDir, filename);
        fs.writeFileSync(localPath, response.data);

        // Generate public URL
        const publicUrl = `/uploads/messages/${subdir}/${filename}`;

        console.log(`✅ Media downloaded: ${publicUrl} (${response.data.length} bytes)`);

        return {
            localPath: publicUrl,
            publicUrl,
            size: response.data.length
        };
    }

    private getSubdirectory(mimeType: string): string {
        if (mimeType.startsWith('image/')) return 'images';
        if (mimeType.startsWith('audio/')) return 'audios';
        if (mimeType.startsWith('video/')) return 'videos';
        return 'documents';
    }

    private getExtension(mimeType: string): string {
        const map: Record<string, string> = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'audio/ogg': '.ogg',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'video/mp4': '.mp4',
            'video/quicktime': '.mov',
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        };
        return map[mimeType] || '.bin';
    }
}
