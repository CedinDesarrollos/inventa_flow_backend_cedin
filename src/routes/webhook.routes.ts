import { Router } from 'express';
import {
    handleTwilioIncoming,
    handleTwilioStatus
} from '../controllers/webhook.controller';

const router = Router();

// POST /api/webhooks/twilio/incoming - Receive incoming messages from Twilio
router.post('/twilio/incoming', handleTwilioIncoming);

// POST /api/webhooks/twilio/status - Receive message status updates from Twilio
router.post('/twilio/status', handleTwilioStatus);

export default router;
