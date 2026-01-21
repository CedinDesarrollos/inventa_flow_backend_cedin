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

        // Step 1: Request the URL from Twilio with redirects disabled
        // We do this to get the S3 redirect URL without automatically following it with credentials
        const initialResponse = await axios.get(mediaUrl, {
            auth,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400
        });

        let downloadUrl = mediaUrl;
        let downloadConfig: any = { responseType: 'arraybuffer' };

        // Step 2: Check if we got a redirect (Twilio usually returns 307 to S3)
        if (initialResponse.status >= 300 && initialResponse.status < 400 && initialResponse.headers.location) {
            downloadUrl = initialResponse.headers.location;
            // IMPORTANT: Do NOT include 'auth' for the S3 URL, as it causes 403 Forbidden
            console.log('🔄 Following redirect to S3 (stripping credentials)...');
        } else {
            // If no redirect, use the initial response data if it's the file itself
            // But usually Twilio redirects. If we somehow got the file directly, return it.
            if (initialResponse.data) {
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
                // content might be buffer or string depending on axios config, 
                // but we didn't set arraybuffer on first call. 
                // Let's rely on the second call pattern for consistency unless strictly needed.
                // Re-downloading from same URL if no redirect is safer to ensure arraybuffer.
                downloadConfig = { auth, responseType: 'arraybuffer' };
            }
        }

        // Step 3: Download the actual file (from S3 or Twilio)
        const response = await axios.get(downloadUrl, downloadConfig);

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
