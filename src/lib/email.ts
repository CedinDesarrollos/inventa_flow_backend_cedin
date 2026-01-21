import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: "mail.inventa.com.py",
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: "no-reply@inventa.com.py",
        pass: "n}zGDAG[R~?fVCAb",
    },
});

export const sendWelcomeEmail = async (email: string, name: string, username: string, tempPass: string) => {
    try {
        const info = await transporter.sendMail({
            from: '"InventaFlow System" <no-reply@inventa.com.py>', // sender address
            to: email, // list of receivers
            subject: "Bienvenido a InventaFlow - Acceso al Sistema", // Subject line
            html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Hola ${name},</h2>
                <p>Se ha creado tu cuenta profesional en <strong>InventaFlow</strong>.</p>
                <p>Aquí tienes tus credenciales de acceso:</p>
                <ul>
                    <li><strong>URL:</strong> <a href="http://localhost:5173">InventaFlow Login</a></li>
                    <li><strong>Usuario:</strong> ${username}</li>
                    <li><strong>Contraseña Temporal:</strong> ${tempPass}</li>
                </ul>
                <p>Por favor, cambia tu contraseña al iniciar sesión por primera vez.</p>
                <div style="margin-top: 20px; font-size: 12px; color: #777;">
                    <p>Este es un mensaje automático, por favor no respondas a este correo.</p>
                </div>
            </div>
            `,
        });

        console.log("Message sent: %s", info.messageId);
        return true;
    } catch (error) {
        console.error("Error sending welcome email:", error);
        return false;
    }
};

export const sendPasswordResetEmail = async (email: string, name: string, resetUrl: string) => {
    try {
        const info = await transporter.sendMail({
            from: '"InventaFlow System" <no-reply@inventa.com.py>',
            to: email,
            subject: "Recuperación de Contraseña - InventaFlow",
            html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Hola ${name},</h2>
                <p>Hemos recibido una solicitud para restablecer tu contraseña en <strong>InventaFlow</strong>.</p>
                <p>Si no has sido tú, puedes ignorar este correo.</p>
                <div style="margin: 24px 0;">
                    <a href="${resetUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Restablecer Contraseña</a>
                </div>
                <p>O copia y pega el siguiente enlace en tu navegador:</p>
                <p style="color: #666; font-size: 13px;">${resetUrl}</p>
                <div style="margin-top: 20px; font-size: 12px; color: #777;">
                    <p>Este enlace expirará en 1 hora.</p>
                </div>
            </div>
            `,
        });

        console.log("Reset password email sent: %s", info.messageId);
        return true;
    } catch (error) {
        console.error("Error sending reset password email:", error);
        return false;
    }
};

export const generateSecurePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    let pass = "";
    for (let i = 0; i < 10; i++) {
        pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
};
