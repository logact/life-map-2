import { v4 } from "uuid";

export interface Note {
    id: string;
    text: string;
    createdAt: Date;
    updatedAt: Date;
}

export function createNote(text: string): Note {
    const now = new Date();
    return { id: v4(), text, createdAt: now, updatedAt: now };
}
