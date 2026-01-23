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
    /**
     * Downloads multimedia from Twilio and saves it locally with retry logic and robust redirect handling
     */
    async downloadTwilioMedia(mediaUrl: string, mediaType: string): Promise<{
        localPath: string;
        publicUrl: string;
        size: number;
    }> {
        const MAX_RETRIES = 3;
        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    console.log(`⚠️ Retry attempt ${attempt}/${MAX_RETRIES} for ${mediaUrl}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
                }

                return await this.executeDownload(mediaUrl, mediaType);
            } catch (error: any) {
                console.error(`❌ Download failed (Attempt ${attempt}):`, error.message);
                lastError = error;
            }
        }

        throw lastError || new Error('Failed to download media after multiple attempts');
    }

    private async executeDownload(mediaUrl: string, mediaType: string) {
        const auth = {
            username: process.env.TWILIO_ACCOUNT_SID!,
            password: process.env.TWILIO_AUTH_TOKEN!
        };

        console.log(`⬇️ Starting smart download for: ${mediaUrl}`);

        // Step 1: Resolve the final URL (handling redirects intelligently)
        const finalUrl = await this.resolveFinalUrl(mediaUrl, auth);
        const isTwilio = finalUrl.includes('twilio.com');

        // Step 2: Download the actual file
        // If it's still a Twilio URL after resolution, we keep auth. If it's S3/other, we drop it.
        const downloadConfig: any = {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Node.js/InventaFlow',
                'Accept': '*/*'
            }
        };

        if (isTwilio) {
            downloadConfig.auth = auth;
        } else {
            console.log('ℹ️ Downloading from external storage (S3/Other) without Twilio Auth');
        }

        const response = await axios.get(finalUrl, downloadConfig);

        // Save file
        const subdir = this.getSubdirectory(mediaType);
        const ext = this.getExtension(mediaType);
        const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;

        const fullDir = path.join(this.uploadDir, 'messages', subdir);
        if (!fs.existsSync(fullDir)) {
            fs.mkdirSync(fullDir, { recursive: true });
        }

        const localPath = path.join(fullDir, filename);
        fs.writeFileSync(localPath, response.data);

        const publicUrl = `/uploads/messages/${subdir}/${filename}`;
        console.log(`✅ Media downloaded: ${publicUrl} (${response.data.length} bytes)`);

        return {
            localPath: publicUrl,
            publicUrl,
            size: response.data.length
        };
    }

    /**
     * Follows redirects while managing authentication headers
     * - Keeps Auth for twilio.com domains
     * - Drops Auth for external domains (like S3)
     */
    private async resolveFinalUrl(initialUrl: string, auth: any): Promise<string> {
        let currentUrl = initialUrl;
        let redirectCount = 0;
        const MAX_REDIRECTS = 5;

        while (redirectCount < MAX_REDIRECTS) {
            const isTwilio = currentUrl.includes('twilio.com');
            const config: any = {
                maxRedirects: 0,
                validateStatus: (status: number) => status >= 200 && status < 400,
                headers: { 'User-Agent': 'Node.js/InventaFlow' }
            };

            if (isTwilio) {
                config.auth = auth;
            }

            try {
                const response = await axios.get(currentUrl, config);

                // If 200 OK, this is the final URL (or it successfully returned content)
                if (response.status === 200) {
                    return currentUrl;
                }

                // If Redirect
                if (response.status >= 300 && response.status < 400 && response.headers.location) {
                    const nextUrl = response.headers.location;
                    console.log(`wm Redirecting: ...${currentUrl.slice(-20)} -> ...${nextUrl.slice(-20)}`);
                    currentUrl = nextUrl;
                    redirectCount++;
                } else {
                    // Unknown state
                    return currentUrl;
                }
            } catch (error: any) {
                // If it fails, we might just try to return the current URL and hope the final download works
                // or throw if it's a 404
                if (error.response?.status === 404) {
                    throw new Error(`Resource not found: ${currentUrl}`);
                }
                throw error;
            }
        }

        return currentUrl;
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
