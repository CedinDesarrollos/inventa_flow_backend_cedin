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

        // Step 0: Debug - Fetch Metadata first to verify resource existence
        // This helps us distinguish between 'Image not found' and 'Redirect failed'
        try {
            console.log(`🔍 Checking media metadata: ${mediaUrl}.json`);
            await axios.get(`${mediaUrl}.json`, { auth });
            console.log('✅ Media metadata found. Resource exists.');
        } catch (error: any) {
            console.error('❌ Failed to fetch media metadata:', error.response?.status, error.message);
            if (error.response?.status === 404) {
                throw new Error('Media resource not found on Twilio (404)');
            }
        }

        // Step 1: Request the binary URL from Twilio with redirects disabled
        console.log(`⬇️  Starting download for: ${mediaUrl}`);
        const initialResponse = await axios.get(mediaUrl, {
            auth,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
            headers: {
                'User-Agent': 'Node.js/InventaFlow',
                'Accept': '*/*'
            }
        });

        let downloadUrl = mediaUrl;
        let downloadConfig: any = {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Node.js/InventaFlow',
                'Accept': '*/*'
            }
        };

        // Step 2: Check if we got a redirect (Twilio usually returns 307 to S3)
        if (initialResponse.status >= 300 && initialResponse.status < 400 && initialResponse.headers.location) {
            downloadUrl = initialResponse.headers.location;
            // IMPORTANT: Do NOT include 'auth' for the S3 URL, as it causes 403 Forbidden
            console.log('🔄 Following redirect to S3 (stripping credentials)...');
        } else {
            console.log(`ℹ️  No redirect received (Status: ${initialResponse.status}). Attempting direct download.`);
            if (initialResponse.data) {
                // If we got data directly (rare for Twilio Media), use it
                // We need to handle this case carefully if responseType wasn't arraybuffer
                // Ideally we re-request to ensure consistency
                downloadConfig = { ...downloadConfig, auth };
            } else {
                // Prepare to download from original URL if no redirect
                downloadConfig = { ...downloadConfig, auth };
            }
        }

        // Step 3: Download the actual file
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
