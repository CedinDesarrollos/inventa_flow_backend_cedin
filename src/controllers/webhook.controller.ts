import type { Request, Response } from 'express';
import { DateTime } from 'luxon';
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

        // Check if message is from our own number (Loopback/Echo)
        const systemConfig = await prisma.systemSetting.findUnique({
            where: { key: 'system_config' }
        });

        if (systemConfig?.value) {
            const configValue = systemConfig.value as any;
            const systemPhone = configValue.phone?.replace(/\D/g, ''); // Remove non-digits

            // Flexible match (exact or endsWith to handle country codes differences)
            if (systemPhone && (phoneNumber === systemPhone || phoneNumber.endsWith(systemPhone) || systemPhone.endsWith(phoneNumber))) {
                console.log(`🛑 Ignoring message from own system number: ${phoneNumber}`);
                return res.status(200).send('OK (Ignored Self-Message)');
            }
        }

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
                    lid: phoneNumber // Store WhatsApp ID as LID
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
        let payload = ButtonPayload || Body || '';

        // Normalize text input if no button payload
        if (!ButtonPayload && payload) {
            const text = payload.trim().toLowerCase();
            if (text === 'confirmo' || text === 'confirmar' || text === 'si' || text === 'sí' || text === 'confirmado') {
                payload = 'confirm_yes';
            } else if (text === 'cancelar' || text === 'cancelo' || text === 'no' || text === 'no podré') {
                payload = 'confirm_cancel';
            } else if (text === 'reagendar' || text === 'cambiar') {
                payload = 'confirm_reschedule';
            }
        }

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
                        status: 'delivered',
                        provider: 'twilio'
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
                        externalUrl: MediaUrl0,
                        provider: 'twilio'
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
                    status: 'delivered',
                    provider: 'twilio'
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
import { createNotification } from './notification.controller';

// ...

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
                orderBy: { date: 'asc' },
                include: { reminders: true }
            });

            if (appointment) {
                await prisma.appointment.update({
                    where: { id: appointment.id },
                    data: { status: 'CONFIRMED' }
                });
                console.log(`✅ Appointment ${appointment.id} confirmed by patient`);

                // Update Reminder Status
                const lastReminder = appointment.reminders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
                if (lastReminder) {
                    await prisma.appointmentReminder.update({
                        where: { id: lastReminder.id },
                        data: { status: 'confirmed' }
                    });
                }

                // [Notification]
                const dateStr = DateTime.fromJSDate(appointment.date).toFormat('dd/MM HH:mm');
                await createNotification({
                    type: 'success',
                    title: 'Cita Confirmada',
                    message: `${patient.firstName} ${patient.lastName} confirmó su consulta del ${dateStr} hs.`,
                    link: `/citas?id=${appointment.id}`
                });
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
                    status: 'delivered',
                    provider: 'twilio'
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
                orderBy: { date: 'asc' },
                include: { reminders: true }
            });

            if (appointmentToCancel) {
                await prisma.appointment.update({
                    where: { id: appointmentToCancel.id },
                    data: { status: 'CANCELLED' }
                });
                console.log(`❌ Appointment ${appointmentToCancel.id} cancelled by patient`);

                // Update Reminder Status
                const lastReminder = appointmentToCancel.reminders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
                if (lastReminder) {
                    await prisma.appointmentReminder.update({
                        where: { id: lastReminder.id },
                        data: { status: 'cancelled' }
                    });
                }

                // [Notification]
                const dateStr = DateTime.fromJSDate(appointmentToCancel.date).toFormat('dd/MM HH:mm');
                await createNotification({
                    type: 'error',
                    title: 'Cita Cancelada',
                    message: `${patient.firstName} ${patient.lastName} canceló su cita del ${dateStr} hs.`,
                    link: `/citas?id=${appointmentToCancel.id}`
                });
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
                    status: 'delivered',
                    provider: 'twilio'
                }
            });
            break;

        case 'confirm_reschedule':
            // Find appointment to mark reminder
            const appointmentToReschedule = await prisma.appointment.findFirst({
                where: {
                    patientId: patient.id,
                    date: { gte: new Date() },
                    status: { in: ['SCHEDULED', 'CONFIRMED'] }
                },
                orderBy: { date: 'asc' },
                include: { reminders: true }
            });

            if (appointmentToReschedule) {
                // Update Reminder Status ONLY (Appointment status stays SCHEDULED until human changes it)
                const lastReminder = appointmentToReschedule.reminders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
                if (lastReminder) {
                    await prisma.appointmentReminder.update({
                        where: { id: lastReminder.id },
                        data: { status: 'rescheduled' }
                    });
                }

                // [Notification]
                const dateStr = DateTime.fromJSDate(appointmentToReschedule.date).toFormat('dd/MM HH:mm');
                await createNotification({
                    type: 'warning',
                    title: 'Solicitud de Reagendamiento',
                    message: `${patient.firstName} ${patient.lastName} solicitó reagendar su consulta del ${dateStr} hs.`,
                    link: `/chat?patientId=${patient.id}`
                });
            }

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
                    status: 'delivered',
                    provider: 'twilio'
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
