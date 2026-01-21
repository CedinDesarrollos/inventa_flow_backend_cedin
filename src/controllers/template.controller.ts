import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

const templateSchema = z.object({
    title: z.string().min(1, "El título es requerido"),
    description: z.string().optional(),
    content: z.string().min(1, "El contenido es requerido"),
});

const DEFAULT_TEMPLATES = [
    {
        title: 'Examen Físico Normal',
        description: 'Registro estructurado de signos vitales y examen físico por sistemas.',
        content: `<h3>Examen Físico</h3><p><strong>Signos Vitales:</strong> PA: __/__ mmHg | FC: __ lpm | FR: __ rpm | SatO2: __% | T°: __°C</p><p><strong>General:</strong> Paciente lúcido, orientado en tiempo y espacio (LOTEP), en buen estado general.</p><p><strong>Cabeza y Cuello:</strong> Normocéfalo, pupilas isocóricas fotorreactivas. Cuello móvil, sin adenopatías.</p><p><strong>Tórax:</strong> Murmullo pulmonar presente, sin ruidos agregados. Ruidos cardíacos regulares (R1-R2), sin soplos.</p><p><strong>Abdomen:</strong> Blando, depresible, indoloro (BDI), RHA (+) conservados.</p>`
    },
    {
        title: 'Anamnesis General',
        description: 'Plantilla estándar para interrogatorio inicial y motivo de consulta.',
        content: `<h3>Anamnesis</h3><p><strong>Motivo de Consulta:</strong> </p><p><strong>Historia de la Enfermedad Actual:</strong> Paciente de __ años que consulta por cuadro de __ días de evolución caracterizado por...</p>`
    },
    {
        title: 'Receta Médica',
        description: 'Formato básico para prescripción de medicamentos e indicaciones.',
        content: `<h3>Indicaciones y Tratamiento</h3><ul><li><strong>Medicamento:</strong> </li><li><strong>Dosis:</strong> </li><li><strong>Duración:</strong> </li></ul><p><strong>Observaciones:</strong> </p>`
    }
];

export const getTemplates = async (req: Request, res: Response) => {
    try {
        const templates = await prisma.template.findMany({
            where: { isActive: true },
            orderBy: { title: 'asc' }
        });

        // Optimization: If no templates exist, seed defaults automatically (for this strict user requirement)
        // Note: In production this might be a separate seeder script, but for this interaction it facilitates the "Podemos crear con..." request.
        if (templates.length === 0 && (req as any).user) {
            console.log('Seeding default templates...');
            const userId = (req as any).user.userId;
            const seeded = await Promise.all(DEFAULT_TEMPLATES.map(t =>
                prisma.template.create({
                    data: {
                        ...t,
                        createdBy: userId,
                        isActive: true
                    }
                })
            ));
            return res.json(seeded);
        }

        res.json(templates);
    } catch (error) {
        console.error('Get Templates Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createTemplate = async (req: Request, res: Response) => {
    try {
        const { title, description, content } = templateSchema.parse(req.body);
        const userId = (req as any).user.userId;

        const template = await prisma.template.create({
            data: {
                title,
                description,
                content,
                createdBy: userId,
                isActive: true
            }
        });

        res.status(201).json(template);
    } catch (error) {
        console.error('Create Template Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateTemplate = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { title, description, content } = templateSchema.parse(req.body);

        const template = await prisma.template.update({
            where: { id },
            data: { title, description, content }
        });

        res.json(template);
    } catch (error) {
        console.error('Update Template Error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ errors: (error as any).errors });
        }
        res.status(500).json({ message: 'Error updating template' });
    }
};

export const deleteTemplate = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        console.log(`Soft deleting template: ${id}`);
        await prisma.template.update({
            where: { id },
            data: { isActive: false }
        });
        res.json({ message: 'Plantilla eliminada' });
    } catch (error) {
        console.error('Delete Template Error:', error);
        res.status(500).json({ message: 'Error al eliminar plantilla' });
    }
};
