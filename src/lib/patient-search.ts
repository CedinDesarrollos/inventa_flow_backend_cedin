// Búsqueda tolerante de pacientes: sin tildes ni mayúsculas, palabras en cualquier orden,
// coincidencias parciales y errores de tipeo leves. Mantener igual en frontend y backend.

export interface SearchablePatient {
    firstName?: string | null;
    lastName?: string | null;
    identifier?: string | null;
    phone?: string | null;
}

export function normalizeSearchText(value: string | null | undefined): string {
    return (value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        previous = current;
    }
    return previous[b.length];
}

function wordScore(word: string, tokens: string[]): number {
    let best = 0;
    const allowedTypos = /\d/.test(word) ? 0 : word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0;
    for (const token of tokens) {
        if (token === word) return 4;
        if (token.startsWith(word)) best = Math.max(best, 3);
        else if (word.length >= 3 && token.includes(word)) best = Math.max(best, 2);
        else if (allowedTypos && best < 1) {
            // Compara contra la palabra entera y contra su inicio, para tolerar errores mientras se escribe.
            const distance = Math.min(editDistance(word, token), editDistance(word, token.slice(0, word.length)));
            if (distance <= allowedTypos) best = 1;
        }
    }
    return best;
}

/** Puntaje de coincidencia (0 = no coincide). `extraText` suma campos buscables propios de cada pantalla. */
export function patientSearchScore(patient: SearchablePatient, query: string, extraText: string[] = []): number {
    const words = normalizeSearchText(query).split(' ').filter(Boolean);
    if (words.length === 0) return 1;

    // Documento o teléfono escrito con puntos, guiones o espacios.
    const compactQuery = words.join('');
    const compactIds = [patient.identifier, patient.phone].map((v) => normalizeSearchText(v).replace(/ /g, ''));
    if (compactQuery.length >= 3 && compactIds.some((id) => id.includes(compactQuery))) return 100;

    const tokens = [patient.firstName, patient.lastName, patient.identifier, patient.phone, ...extraText]
        .flatMap((v) => normalizeSearchText(v).split(' '))
        .filter(Boolean);

    let total = 0;
    for (const word of words) {
        const score = wordScore(word, tokens);
        if (score === 0) return 0;
        total += score;
    }
    return total;
}

/** Filtra y ordena por relevancia (mejores coincidencias primero, empates en el orden original). */
export function searchPatients<T extends SearchablePatient>(patients: T[], query: string, extraText?: (patient: T) => string[]): T[] {
    if (!normalizeSearchText(query)) return patients;
    return patients
        .map((patient, index) => ({ patient, index, score: patientSearchScore(patient, query, extraText?.(patient)) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((r) => r.patient);
}
