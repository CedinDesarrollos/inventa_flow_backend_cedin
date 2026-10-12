export function runtimeConfigErrors(env: NodeJS.ProcessEnv): string[] {
    const errors: string[] = [];
    for (const name of ['JWT_SECRET', 'DATABASE_URL']) if (!env[name]?.trim()) errors.push(`${name} is required`);
    if (env.PORT && (!/^\d+$/.test(env.PORT) || Number(env.PORT) < 1 || Number(env.PORT) > 65535)) errors.push('PORT must be between 1 and 65535');
    if (env.DATABASE_URL) {
        try {
            const url = new URL(env.DATABASE_URL);
            if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push('DATABASE_URL must use PostgreSQL');
        } catch { errors.push('DATABASE_URL is invalid'); }
    }
    if (env.NODE_ENV === 'production') {
        if (!env.CORS_ORIGIN?.split(',').some(origin => origin.trim().startsWith('https://'))) errors.push('CORS_ORIGIN must include the HTTPS frontend origin');
        if (!env.UPLOAD_DIR) errors.push('UPLOAD_DIR must point to the persistent volume');
        if (!env.PUBLIC_URL) errors.push('PUBLIC_URL is required for public upload and WhatsApp links');
    }
    for (const name of ['PUBLIC_URL', 'FRONTEND_URL']) {
        if (!env[name]) continue;
        try {
            const url = new URL(env[name]);
            if (!['http:', 'https:'].includes(url.protocol) || url.hostname.endsWith('.railway.internal')) errors.push(`${name} must be a public HTTP(S) URL`);
            if (env.NODE_ENV === 'production' && (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname))) errors.push(`${name} must use a public HTTPS URL in production`);
        } catch { errors.push(`${name} is invalid`); }
    }
    return errors;
}
