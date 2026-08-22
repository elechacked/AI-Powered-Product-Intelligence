/**
 * search_provider.mjs
 * Abstract search provider interface.
 * Implemented using Serper.dev
 */

/**
 * Executes a web search.
 * 
 * @param {string} query The search query string.
 * @param {object} options Optional search parameters.
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
export async function search(query, options = {}) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY environment variable is missing.");
  }

  const payload = JSON.stringify({
    q: query,
    num: options.num || 10,
    ...options
  });

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(`Search provider API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const results = data.organic || [];

  return results.map(item => ({
    title: item.title || "",
    url: item.link || "",
    snippet: item.snippet || ""
  }));
}
