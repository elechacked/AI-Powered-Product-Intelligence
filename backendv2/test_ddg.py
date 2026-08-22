from duckduckgo_search import DDGS
import json

def test():
    results = list(DDGS().text("Freud Inc official website", max_results=5))
    urls = [r.get("href") for r in results if r.get("href")]
    print(json.dumps(urls, indent=2))

test()
