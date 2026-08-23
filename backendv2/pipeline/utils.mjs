export function extractJsonObject(rawText) {
    if (typeof rawText !== 'string') {
        throw new Error("Input to extractJsonObject must be a string");
    }
    
    // 1. Try markdown extraction
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    let textToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
    
    try {
        return JSON.parse(textToParse);
    } catch (e) {
        // Fallback: robust brace balancing that ignores braces inside strings.
        const startIndex = textToParse.indexOf('{');
        const startArray = textToParse.indexOf('[');
        
        if (startIndex === -1 && startArray === -1) {
            throw e;
        }
        
        let start = -1;
        if (startIndex !== -1 && startArray !== -1) {
            start = Math.min(startIndex, startArray);
        } else {
            start = Math.max(startIndex, startArray);
        }
        
        const isObject = textToParse[start] === '{';
        
        let openBraces = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = start; i < textToParse.length; i++) {
            const char = textToParse[i];
            
            if (!inString) {
                if (char === '"') {
                    inString = true;
                } else if (char === '{' && isObject) {
                    openBraces++;
                } else if (char === '}' && isObject) {
                    openBraces--;
                } else if (char === '[' && !isObject) {
                    openBraces++;
                } else if (char === ']' && !isObject) {
                    openBraces--;
                }
                
                if (openBraces === 0) {
                    // Reached the end of the balanced JSON object/array
                    const possibleJson = textToParse.substring(start, i + 1);
                    try {
                        return JSON.parse(possibleJson);
                    } catch (innerE) {
                        break; // fallback to the basic lastIndexOf
                    }
                }
            } else {
                if (escapeNext) {
                    escapeNext = false;
                } else if (char === '\\') {
                    escapeNext = true;
                } else if (char === '"') {
                    inString = false;
                }
            }
        }
        
        // If robust matching failed, fallback to first-to-last
        const first = start;
        const last = isObject ? textToParse.lastIndexOf('}') : textToParse.lastIndexOf(']');
        if (first !== -1 && last !== -1 && last > first) {
            try {
                return JSON.parse(textToParse.substring(first, last + 1));
            } catch (err) {
                throw new Error("Failed to parse JSON even after substring extraction");
            }
        }
        
        throw e;
    }
}
