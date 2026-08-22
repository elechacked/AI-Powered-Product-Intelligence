/**
 * url_discovery.mjs
 * Orchestration layer: Discovers product URLs by resolving source names to domains
 * and then searching for the MPN within those domains.
 */

import { search } from './search_provider.mjs';
import { getDomainCache, setDomainCache, getProductCache, setProductCache } from './cache_manager.mjs';
import { tieredProductSearch } from './tiered_search.mjs';

const BLOCKED_DOMAINS = new Set([
  "amazon.com", "ebay.com", "walmart.com", "homedepot.com", "lowes.com",
  "target.com", "aliexpress.com", "alibaba.com", "grainger.com", "mcmaster.com",
  "mouser.com", "digikey.com", "fastenal.com", "wikipedia.org", "facebook.com",
  "twitter.com", "linkedin.com", "instagram.com", "youtube.com", "reddit.com",
  "pinterest.com", "duckduckgo.com", "google.com", "bing.com"
]);

// ─── Core Logic ──────────────────────────────────────────────────────────────

function getCoreName(companyName) {
  return companyName.toLowerCase()
    .replace(/\b(inc|llc|corp|ltd|co|corporation|company)\b\.?/g, '')
    .trim();
}

function scoreDomainCandidate(companyName, item) {
  const coreName = getCoreName(companyName);
  const titleLower = item.title.toLowerCase();
  const snippetLower = item.snippet.toLowerCase();

  let hostname = "";
  try {
    hostname = new URL(item.url).hostname.toLowerCase();
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
  } catch(e) {}
  
  if (!hostname || BLOCKED_DOMAINS.has(hostname) || !hostname.includes('.')) {
    return { score: 0, hostname: null };
  }

  let score = 0;
  const slug = coreName.replace(/[^a-z0-9]/g, '');
  
  const domainParts = hostname.split('.');
  const domainName = domainParts.length > 1 ? domainParts[domainParts.length - 2] : hostname;

  if (slug === domainName) {
    score += 0.8; // Exact domain name match (e.g. 3m == 3m.com)
  } else if (slug.length > 2 && hostname.includes(slug)) {
    score += 0.7; // Strong signal: brand is in the root domain name
  } else if (coreName.length > 2 && item.url.toLowerCase().includes(coreName.replace(/\s+/g, '-'))) {
    score += 0.1; // Weak signal: brand is just in the URL path (could be a reseller)
  }

  if (titleLower.includes(coreName)) {
    score += 0.3;
  }

  if (titleLower.includes('official') || snippetLower.includes('official')) {
    score += 0.4;
  }

  // Penalize known store indicators in title/snippet if the domain doesn't match exactly
  if (score < 0.8 && (titleLower.includes('buy') || titleLower.includes('store') || titleLower.includes('shop'))) {
    score -= 0.3;
  }
  
  return { score, hostname };
}

/**
 * Resolves a company name to its official domain via search with persistent caching.
 */
export async function resolveOfficialDomain(companyName) {
  const cached = getDomainCache(companyName);
  if (cached) {
    return { 
      domain: cached.official_domain, 
      cacheHit: true,
      confidence: cached.resolution_confidence,
      status: cached.status
    };
  }

  const query = `${companyName} manufacturer official website`;
  let results = [];
  let apiError = false;
  try {
    results = await search(query, { num: 5 });
  } catch (err) {
    console.warn(`[WARN] Search failed for "${query}":`, err.message);
    apiError = true;
  }
  
  if (apiError) {
    return { domain: null, cacheHit: false, confidence: 0, error: true, status: 'failed' };
  }

  let bestCandidate = null;
  let bestScore = 0;

  for (const item of results) {
    const { score, hostname } = scoreDomainCandidate(companyName, item);
    if (score > bestScore && hostname) {
      bestScore = score;
      bestCandidate = hostname;
    }
  }

  const THRESHOLD = 0.6;

  if (bestCandidate && bestScore >= THRESHOLD) {
    setDomainCache(companyName, {
      official_domain: bestCandidate,
      status: 'success',
      resolution_confidence: bestScore,
      resolution_method: 'search_result_validated',
      validated_at: new Date().toISOString()
    });
    return { domain: bestCandidate, cacheHit: false, confidence: bestScore, status: 'success' };
  }

  // Cache negative result
  setDomainCache(companyName, {
    official_domain: null,
    status: 'not_found',
    resolution_confidence: bestScore,
    resolution_method: 'search_result_validated'
  });
  return { domain: null, cacheHit: false, confidence: bestScore, status: 'not_found' };
}

/**
 * Searches for a specific MPN restricted to a resolved domain with persistent caching.
 */
export async function findProductUrlsOnDomain(domain, mpn) {
  const cached = getProductCache(domain, mpn);
  if (cached) {
    return {
      product_url: cached.product_url,
      sku_match_status: cached.sku_match_status,
      url_status: cached.url_status,
      cacheHit: true
    };
  }

  const query = `site:${domain} "${mpn}"`;
  let results = [];
  let apiError = false;
  try {
    results = await search(query, { num: 3 });
  } catch (err) {
    console.warn(`[WARN] Search failed for "${query}":`, err.message);
    apiError = true;
  }
  
  if (apiError) {
    return {
      product_url: null,
      sku_match_status: 'no_match',
      url_status: 'failed',
      cacheHit: false
    };
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
      sku_match_status: 'exact',
      url_status: 'success'
    };
    setProductCache(domain, mpn, data);
    return { ...data, cacheHit: false };
  } else {
    const data = {
      product_url: null,
      sku_match_status: 'no_match',
      url_status: 'not_found'
    };
    setProductCache(domain, mpn, data);
    return { ...data, cacheHit: false };
  }
}

/**
 * Extracts and deduplicates source names from a normalized product.
 */
export function extractSources(normalizedProduct) {
  const sources = [];
  
  if (normalizedProduct.part_manuf?.company_name) {
    sources.push({ name: normalizedProduct.part_manuf.company_name, role: 'part_manuf' });
  }
  if (normalizedProduct.brand_hints?.e1_brand) {
    sources.push({ name: normalizedProduct.brand_hints.e1_brand, role: 'e1_brand' });
  }
  if (normalizedProduct.brand_hints?.unilog_brand) {
    sources.push({ name: normalizedProduct.brand_hints.unilog_brand, role: 'unilog_brand' });
  }
  if (normalizedProduct.brand_hints?.dib_brand) {
    sources.push({ name: normalizedProduct.brand_hints.dib_brand, role: 'dib_brand' });
  }
  if (normalizedProduct.part_desc) {
    const parts = normalizedProduct.part_desc.split(' ');
    let brandCandidate = parts[0].replace(/[^a-zA-Z0-9-]/g, '');
    
    if (brandCandidate === normalizedProduct.mfg_part_num && parts.length > 1) {
      brandCandidate = parts[1].replace(/[^a-zA-Z0-9-]/g, '');
    }
    
    if (brandCandidate.length > 1 && brandCandidate !== normalizedProduct.mfg_part_num) {
      sources.push({ name: brandCandidate, role: 'desc_heuristic' });
    }
  }
  
  const seen = new Set();
  const deduped = [];
  for (const s of sources) {
    const lower = s.name.toLowerCase().trim();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(s);
    }
  }
  
  return deduped;
}

/**
 * Orchestrates the URL discovery process.
 */
export async function discoverUrlsForProduct(normalizedProduct) {
  const sources = extractSources(normalizedProduct);
  const results = [];
  
  for (const source of sources) {
    const result = {
      source_name: source.name,
      source_role: source.role,
      official_domain: null,
      domain_resolution_status: 'failed',
      domain_cache_hit: false,
      resolution_confidence: 0,
      product_url: null,
      sku_match_status: 'no_match',
      url_status: 'failed',
      product_lookup_cache_hit: false
    };
    
    // Step 1: Resolve Domain via Search
    const domainData = await resolveOfficialDomain(source.name);
    result.domain_cache_hit = domainData.cacheHit;
    result.resolution_confidence = domainData.confidence;
    
    if (!domainData.domain) {
      result.domain_resolution_status = domainData.status || 'failed';
      results.push(result);
      continue;
    }
    
    result.official_domain = domainData.domain;
    result.domain_resolution_status = domainData.status || 'success';
    
    // Step 2: Search Exact MPN on Resolved Domain
    const prodRes = await tieredProductSearch(domainData.domain, normalizedProduct, source.role);
    
    result.product_url = prodRes.product_url;
    result.sku_match_status = prodRes.sku_match_status;
    result.url_status = prodRes.url_status;
    result.product_lookup_cache_hit = prodRes.cacheHit;
    
    results.push(result);
  }
  
  return results;
}
