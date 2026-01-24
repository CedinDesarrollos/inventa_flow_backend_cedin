import { Router } from 'express';
import {
    getConversations,
    getConversationMessages,
    sendMessage,
    markAsRead,
    updateStatus
} from '../controllers/conversation.controller';

import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticateToken);

// GET /api/conversations - List all conversations
router.get('/', getConversations);

// GET /api/conversations/:id/messages - Get messages for a conversation
router.get('/:id/messages', getConversationMessages);

// POST /api/conversations/:id/messages - Send a message
router.post('/:id/messages', sendMessage);

// PATCH /api/conversations/:id/read - Mark conversation as read
router.patch('/:id/read', markAsRead);

// PATCH /api/conversations/:id/status - Update conversation status
router.patch('/:id/status', updateStatus);

export default router;
