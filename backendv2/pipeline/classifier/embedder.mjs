import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const EMBEDDING_MODEL = 'gemini-embedding-2';

export async function generateEmbedding(text) {
    if (!text || text.trim() === '') {
        return [];
    }
    
    try {
        const response = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text
        });
        return response.embeddings[0].values;
    } catch (err) {
        console.error('Embedding generation failed:', err.message);
        throw err;
    }
}

export function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
