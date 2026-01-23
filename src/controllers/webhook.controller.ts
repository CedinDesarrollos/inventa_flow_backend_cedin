import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { MediaDownloadService } from '../services/media/MediaDownloadService';
import { NotificationService } from '../services/notifications/NotificationService';
import { NpsService } from '../services/nps/NpsService';

/**
 * Handle incoming messages from Twilio
 */
export const handleTwilioIncoming = async (req: Request, res: Response) => {
    try {
        const { From, Body, NumMedia, MediaUrl0, MediaContentType0, ButtonPayload } = req.body;

        console.log('📩 Incoming Twilio webhook:', { From, Body, NumMedia, ButtonPayload });

        if (!From) {
            console.warn('⚠️ Received webhook without "From" field');
            return res.status(400).send('Missing From field');
        }

        const phoneNumber = From.replace('whatsapp:', '').replace('+', '');

        // 0. Intercept NPS Responses (Priority)
        const npsService = new NpsService();
        const npsPayload = ButtonPayload || Body;
        const isButton = !!ButtonPayload;

        const isNpsInteraction = await npsService.handleIncomingMessage(phoneNumber, npsPayload, isButton);

        if (isNpsInteraction) {
            console.log(`📊 Intercepted NPS interaction from ${phoneNumber}`);
            return res.status(200).send('OK (NPS Handled)');
        }

        // Find patient by phone
        let patient = await prisma.patient.findFirst({
            where: {
                phone: {
                    contains: phoneNumber
                }
            }
        });

        if (!patient) {
            console.log(`🆕 Creating new LEAD for unknown number: ${phoneNumber}`);

            // Create new "Lead" patient
            patient = await prisma.patient.create({
                data: {
                    firstName: "Usuario",
                    lastName: "Nuevo",
                    phone: phoneNumber,
                    identifier: `LEAD-${phoneNumber}`, // Unique identifier
                }
            });
        }

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
            where: { patientId: patient.id, channel: 'whatsapp' }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    patientId: patient.id,
                    channel: 'whatsapp',
                    status: 'open'
                }
            });

            // Add "Nuevo Paciente" tag for new leads
            if (patient.identifier.startsWith('LEAD-')) {
                await prisma.conversationTag.create({
                    data: {
                        conversationId: conversation.id,
                        tag: 'Nuevo Paciente'
                    }
                });
            }

            console.log(`✅ Created conversation for ${patient.firstName} ${patient.lastName}`);
        }

        // Handle Quick Reply button responses (Phase 2)
        const payload = ButtonPayload || Body;

        if (payload === 'confirm_yes' || payload === 'confirm_cancel' || payload === 'confirm_reschedule') {
            await handleQuickReplyResponse(conversation, patient, payload);
            return res.status(200).send('OK');
        }

        // Handle multimedia
        if (parseInt(NumMedia || '0') > 0) {
            try {
                const mediaService = new MediaDownloadService();
                const { publicUrl, size } = await mediaService.downloadTwilioMedia(
                    MediaUrl0,
                    MediaContentType0
                );

                await prisma.conversationMessage.create({
                    data: {
                        conversationId: conversation.id,
                        content: Body || '(Archivo adjunto)',
                        type: getMessageType(MediaContentType0),
                        sender: 'patient',
                        mediaUrl: publicUrl,
                        mediaType: MediaContentType0,
                        mediaSize: size,
                        externalUrl: MediaUrl0,
                        status: 'delivered'
                    }
                });

                console.log(`✅ Saved multimedia message: ${publicUrl}`);
            } catch (mediaError) {
                console.error('❌ Failed to download media:', mediaError);

                // Fallback: Save as text message with error note and external URL
                await prisma.conversationMessage.create({
                    data: {
                        conversationId: conversation.id,
                        content: Body || `(Error descargando archivo: ${MediaContentType0})`,
                        type: 'text',
                        sender: 'patient',
                        status: 'delivered',
                        externalUrl: MediaUrl0
                    }
                });
                console.log(`⚠️ Saved fallback text message due to media error`);
            }
        } else {
            // Text message
            await prisma.conversationMessage.create({
                data: {
                    conversationId: conversation.id,
                    content: Body,
                    type: 'text',
                    sender: 'patient',
                    status: 'delivered'
                }
            });

            console.log(`✅ Saved text message from ${patient.firstName}`);
        }

        // Update conversation
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                lastMessageAt: new Date(),
                unreadCount: { increment: 1 }
            }
        });

        res.status(200).send('OK');
    } catch (error: any) {
        console.error('❌ Error handling Twilio webhook:', error);
        res.status(500).send('Error');
    }
};

/**
 * Handle Quick Reply button responses (Phase 2)
 */
async function handleQuickReplyResponse(conversation: any, patient: any, payload: string) {
    const notificationService = new NotificationService();
    await notificationService.initialize();

    switch (payload) {
        case 'confirm_yes':
            // Confirm appointment
            const appointment = await prisma.appointment.findFirst({
                where: {
                    patientId: patient.id,
                    date: { gte: new Date() },
                    status: { in: ['SCHEDULED', 'CONFIRMED'] }
                },
                orderBy: { date: 'asc' }
            });

            if (appointment) {
                await prisma.appointment.update({
                    where: { id: appointment.id },
                    data: { status: 'CONFIRMED' }
                });
                console.log(`✅ Appointment ${appointment.id} confirmed by patient`);
            }

            await notificationService.sendMessage({
                patientId: patient.id,
                message: '¡Perfecto! Tu cita está confirmada. Te esperamos. 😊'
            });

            await prisma.conversationMessage.create({
                data: {
                    conversationId: conversation.id,
                    content: '✅ Confirmó asistencia',
                    type: 'text',
                    sender: 'patient',
                    status: 'delivered'
                }
            });
            break;

        case 'confirm_cancel':
            // Cancel appointment
            const appointmentToCancel = await prisma.appointment.findFirst({
                where: {
                    patientId: patient.id,
                    date: { gte: new Date() },
                    status: { in: ['SCHEDULED', 'CONFIRMED'] }
                },
                orderBy: { date: 'asc' }
            });

            if (appointmentToCancel) {
                await prisma.appointment.update({
                    where: { id: appointmentToCancel.id },
                    data: { status: 'CANCELLED' }
                });
                console.log(`❌ Appointment ${appointmentToCancel.id} cancelled by patient`);
            }

            await notificationService.sendMessage({
                patientId: patient.id,
                message: 'Tu cita ha sido cancelada. Si deseas reagendar, contáctanos. 📞'
            });

            await prisma.conversationMessage.create({
                data: {
                    conversationId: conversation.id,
                    content: '❌ Canceló la cita',
                    type: 'text',
                    sender: 'patient',
                    status: 'delivered'
                }
            });
            break;

        case 'confirm_reschedule':
            await notificationService.sendMessage({
                patientId: patient.id,
                message: 'Entendido. Un miembro de nuestro equipo se comunicará contigo para reagendar. 📅'
            });

            await prisma.conversationMessage.create({
                data: {
                    conversationId: conversation.id,
                    content: '📅 Solicitó reagendar',
                    type: 'text',
                    sender: 'patient',
                    status: 'delivered'
                }
            });

            // Increment unread count to notify staff
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { unreadCount: { increment: 1 } }
            });
            break;
    }
}

/**
 * Determine message type from MIME type
 */
function getMessageType(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
}

/**
 * Handle message status updates from Twilio
 */
export const handleTwilioStatus = async (req: Request, res: Response) => {
    try {
        const { MessageSid, MessageStatus } = req.body;

        console.log(`📊 Message status update: ${MessageSid} → ${MessageStatus}`);

        // Update message status in database
        const updated = await prisma.conversationMessage.updateMany({
            where: { externalId: MessageSid },
            data: { status: MessageStatus }
        });

        if (updated.count > 0) {
            console.log(`✅ Updated ${updated.count} message(s) status to ${MessageStatus}`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error handling status webhook:', error);
        res.status(500).send('Error');
    }
};
