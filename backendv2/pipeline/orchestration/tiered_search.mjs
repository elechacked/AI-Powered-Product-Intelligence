import { search } from './search_provider.mjs';
import { setProductCache, getProductCache } from './cache_manager.mjs';

function generateDescriptionFingerprint(desc) {
  if (!desc) return '';
  const stopWords = new Set(['disc', 'box', 'film', 'stikit', 'inch', 'mm', 'pack', 'case', 'the', 'a', 'an', 'and']);
  const tokens = desc.split(/[\s-]+/).filter(t => t.length > 0);
  const fingerprintTokens = [];
  for (let t of tokens) {
    const clean = t.replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) continue;
    if (stopWords.has(clean.toLowerCase())) continue;
    if (/\d/.test(clean) || /^[A-Z]/.test(clean) || clean.length >= 3) {
      fingerprintTokens.push(clean);
    }
  }
  return fingerprintTokens.slice(0, 5).join(' ');
}

export async function tieredProductSearch(domain, normalizedProduct, sourceRole) {
  const cached = getProductCache(domain, normalizedProduct.mfg_part_num);
  if (cached) {
    return {
      product_url: cached.product_url,
      sku_match_status: cached.sku_match_status,
      url_status: cached.url_status,
      cacheHit: true
    };
  }

  const queries = [];
  const sku = normalizedProduct.mfg_part_num;
  const descFingerprint = generateDescriptionFingerprint(normalizedProduct.part_desc);
  
  // Rule based on source_role
  if (sourceRole === 'part_manuf' || sourceRole === 'distributor') {
    queries.push({ text: `site:${domain} "${sku}"`, match_type: 'exact' });
    if (descFingerprint) queries.push({ text: `site:${domain} "${descFingerprint}"`, match_type: 'description_match' });
  } else if (sourceRole === 'desc_heuristic' || sourceRole.includes('brand')) {
    if (descFingerprint) queries.push({ text: `site:${domain} "${descFingerprint}"`, match_type: 'description_match' });
    queries.push({ text: `site:${domain} "${sku}"`, match_type: 'exact' });
  } else {
    queries.push({ text: `site:${domain} "${sku}"`, match_type: 'exact' });
    if (descFingerprint) queries.push({ text: `site:${domain} "${descFingerprint}"`, match_type: 'description_match' });
  }
  
  // Deduplicate queries and limit to max 2
  const seenQueries = new Set();
  const uniqueQueries = [];
  for (const q of queries) {
      if (!seenQueries.has(q.text)) {
          seenQueries.add(q.text);
          uniqueQueries.push(q);
      }
  }
  const finalQueries = uniqueQueries.slice(0, 2);
  
  for (const queryObj of finalQueries) {
      console.log(`[Tiered Search] Trying query: ${queryObj.text}`);
      let results = [];
      try {
        results = await search(queryObj.text);
      } catch (err) {
        console.error(`Search error for query: ${query}`, err.message);
        continue;
      }
      
      const validUrls = [];
      for (const item of results) {
        try {
          const parsed = new URL(item.url);
          let hostname = parsed.hostname.toLowerCase();
          if (hostname.startsWith('www.')) hostname = hostname.slice(4);
          
          if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            validUrls.push(item.url);
          }
        } catch (e) {}
      }

      if (validUrls.length > 0) {
        const data = {
          product_url: validUrls[0],
          sku_match_status: queryObj.match_type,
          url_status: 'success'
        };
        setProductCache(domain, sku, data);
        return { ...data, cacheHit: false };
      }
  }

  // If we exhaust all queries and find nothing
  const data = {
    product_url: null,
    sku_match_status: 'no_match',
    url_status: 'not_found'
  };
  setProductCache(domain, sku, data);
  return { ...data, cacheHit: false };
}
