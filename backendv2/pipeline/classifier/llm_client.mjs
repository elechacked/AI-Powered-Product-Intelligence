import { Groq } from 'groq-sdk';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../orchestration/db.mjs';

const PRIMARY_MODEL = 'qwen/qwen3.6-27b';
const FALLBACK_MODEL = 'gemma-4-31b-it';

let groq = null;
let genai = null;

if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}
if (process.env.GEMINI_API_KEY) {
    genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function logLlmCall(agent, model, productId, promptTokens, completionTokens, requestText, responseText, systemPrompt, latencyMs) {
    try {
        const pRow = db.prepare('SELECT mfg_part_num FROM products WHERE id = ?').get(productId);
        const sku = pRow ? pRow.mfg_part_num : null;
        
        let totalTokens = 0;
        if (promptTokens && completionTokens) {
            totalTokens = promptTokens + completionTokens;
        }
        
        db.prepare(`
            INSERT INTO llm_logs (created_at, agent_name, model_name, product_id, product_sku, total_tokens, latency_ms, prompt_tokens, completion_tokens, user_prompt, response_text, system_prompt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(new Date().toISOString(), agent, model, productId, sku, totalTokens, latencyMs || 0, promptTokens || 0, completionTokens || 0, requestText, responseText, systemPrompt);
    } catch (err) {
        console.error('Failed to log LLM call:', err.message);
    }
}

export async function invokeClassifierLLM(systemPrompt, userPrompt, productId) {
    const startTime = Date.now();
    
    // Try Primary (Groq)
    if (groq) {
        try {
            const completion = await groq.chat.completions.create({
                model: PRIMARY_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });

            const responseText = completion.choices[0].message.content;
            const latencyMs = Date.now() - startTime;
            logLlmCall('Classifier', PRIMARY_MODEL, productId, completion.usage?.prompt_tokens, completion.usage?.completion_tokens, userPrompt, responseText, systemPrompt, latencyMs);

            // Parse JSON to ensure validity
            const parsed = JSON.parse(responseText);
            return {
                data: parsed,
                raw: responseText,
                model: PRIMARY_MODEL,
                provider: 'Groq',
                fallback: false
            };
        } catch (err) {
            console.error(`Primary model ${PRIMARY_MODEL} via Groq failed: ${err.message}. Attempting fallback...`);
        }
    }

    // Try Fallback (Gemini via @google/genai)
    if (genai) {
        try {
            const response = await genai.models.generateContent({
                model: FALLBACK_MODEL,
                contents: systemPrompt + '\\n\\n' + userPrompt,
                config: {
                    temperature: 0.1,
                    responseMimeType: 'application/json'
                }
            });
            
            const responseText = response.text;
            const latencyMs = Date.now() - startTime;
            const prompt_tokens = response.usageMetadata?.promptTokenCount || 0;
            const completion_tokens = response.usageMetadata?.candidatesTokenCount || 0;
            logLlmCall('Classifier', FALLBACK_MODEL, productId, prompt_tokens, completion_tokens, userPrompt, responseText, systemPrompt, latencyMs);
            
            const parsed = JSON.parse(responseText);
            return {
                data: parsed,
                raw: responseText,
                model: FALLBACK_MODEL,
                provider: 'Google AI Studio',
                fallback: true
            };
        } catch (err) {
            console.error(`Fallback model ${FALLBACK_MODEL} failed: ${err.message}`);
            throw err;
        }
    }

    throw new Error('No valid LLM client configured (missing API keys?)');
}
