import { db } from '../orchestration/db.mjs';
import { cosineSimilarity } from './embedder.mjs';

export function getAllTaxonomyNodes() {
    const rows = db.prepare('SELECT id, parent_id, level, name, canonical_path, embedding FROM taxonomy_nodes').all();
    return rows.map(r => ({
        ...r,
        embedding: r.embedding ? JSON.parse(r.embedding) : []
    }));
}

export function findSimilarTaxonomyCandidates(productVector, limit = 5) {
    if (!productVector || productVector.length === 0) return [];
    
    const allNodes = getAllTaxonomyNodes();
    // Only return leaf nodes (fine) as candidates to the LLM
    const leafNodes = allNodes.filter(n => n.level === 'fine');
    
    for (const node of leafNodes) {
        node.similarity = cosineSimilarity(productVector, node.embedding);
    }
    
    leafNodes.sort((a, b) => b.similarity - a.similarity);
    
    return leafNodes.slice(0, limit);
}

export function getOrCreateTaxonomyPath(department, className, fineName, embeddingVector) {
    const now = new Date().toISOString();
    let currentParentId = null;
    
    const levels = [
        { level: 'department', name: department },
        { level: 'class', name: className },
        { level: 'fine', name: fineName }
    ];
    
    let canonicalPathParts = [];
    let lastNodeId = null;
    
    for (const lvl of levels) {
        canonicalPathParts.push(lvl.name);
        const pathStr = canonicalPathParts.join(' > ');
        
        let node = db.prepare('SELECT id FROM taxonomy_nodes WHERE canonical_path = ?').get(pathStr);
        if (!node) {
            const vecStr = (lvl.level === 'fine' && embeddingVector) ? JSON.stringify(embeddingVector) : null;
            const res = db.prepare('INSERT INTO taxonomy_nodes (parent_id, level, name, canonical_path, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(currentParentId, lvl.level, lvl.name, pathStr, vecStr, now, now);
            node = { id: res.lastInsertRowid };
        }
        
        currentParentId = node.id;
        lastNodeId = node.id;
    }
    
    return lastNodeId; // Returns the ID of the fine leaf node
}

export function saveProductClassification(productId, taxonomyId, status, jsonOutput, model, provider, fallbackUsed) {
    const now = new Date().toISOString();
    
    db.prepare('DELETE FROM product_classifications WHERE product_id = ?').run(productId);
    
    db.prepare(`
        INSERT INTO product_classifications (
            product_id, taxonomy_id, classification_status, classification_json, 
            model_used, provider_used, fallback_used, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        productId,
        taxonomyId,
        status,
        jsonOutput,
        model,
        provider,
        fallbackUsed ? 1 : 0,
        now,
        now
    );
}
