import type { Prisma } from '@prisma/client';

// Explicitly allow profile fields so credentials never enter API response objects.
export const userProfileSelect = {
    id: true,
    email: true,
    username: true,
    rut: true,
    fullName: true,
    role: true,
    createdAt: true,
    updatedAt: true,
    isActive: true,
    phone: true,
    mustChangePassword: true,
    mustChangePin: true
} satisfies Prisma.UserSelect;
