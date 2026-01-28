
import { AuthenticationCreds, AuthenticationState, SignalDataTypeMap, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { prisma } from '../../../lib/prisma';

export const usePrismaAuthState = async (): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {

    // 1. Helper to read JSON
    const readSession = async (id: string) => {
        try {
            const session = await prisma.baileysSession.findUnique({ where: { id } });
            if (!session) return null;
            return JSON.parse(session.data, BufferJSON.reviver);
        } catch (error) {
            console.error('Error reading session from DB', error);
            return null;
        }
    };

    // 2. Helper to write JSON
    const writeSession = async (id: string, data: any) => {
        try {
            await prisma.baileysSession.upsert({
                where: { id },
                update: { data: JSON.stringify(data, BufferJSON.replacer) },
                create: { id, data: JSON.stringify(data, BufferJSON.replacer) }
            });
        } catch (error) {
            console.error('Error writing session to DB', error);
        }
    }

    // 3. Helper to delete
    const deleteSession = async (id: string) => {
        try {
            await prisma.baileysSession.delete({ where: { id } });
        } catch (e) {
            // Ignore if not exists
        }
    }

    // --- Init Creds ---
    const creds: AuthenticationCreds = (await readSession('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [key: string]: any } = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readSession(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = BufferJSON.reviver(null, value); // Special check
                            }
                            if (value) {
                                data[id] = value;
                            }
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        for (const id in data[category as keyof SignalDataTypeMap]) {
                            const value = data[category as keyof SignalDataTypeMap]?.[id];
                            const key = `${category}-${id}`;

                            if (value) {
                                tasks.push(writeSession(key, value));
                            } else {
                                tasks.push(deleteSession(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeSession('creds', creds);
        }
    };
};
