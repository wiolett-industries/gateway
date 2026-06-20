import { isPrivateUrl } from '@/lib/utils.js';

type WebSearchConfig = {
  webSearchProvider: string;
  webSearchBaseUrl: string;
};

type WebSearchSettingsService = {
  getConfig(): Promise<WebSearchConfig>;
  getDecryptedWebSearchKey(): Promise<string | null>;
};

export async function executeWebSearch(
  settingsService: WebSearchSettingsService,
  query: string,
  maxResults: number
): Promise<unknown> {
  const config = await settingsService.getConfig();
  const apiKey = await settingsService.getDecryptedWebSearchKey();

  // SearXNG doesn't require an API key.
  if (!apiKey && config.webSearchProvider !== 'searxng') {
    return { error: 'Web search is not configured. An admin must set up the web search API key.' };
  }
  if (config.webSearchProvider === 'searxng' && !config.webSearchBaseUrl) {
    return { error: 'SearXNG requires a base URL. Configure it in AI settings.' };
  }

  const limit = Math.min(maxResults, 10);

  try {
    switch (config.webSearchProvider) {
      case 'tavily':
        return searchTavily(apiKey!, query, limit);
      case 'brave':
        return searchBrave(apiKey!, query, limit);
      case 'serper':
        return searchSerper(apiKey!, query, limit);
      case 'searxng':
        return searchSearxng(config.webSearchBaseUrl, query, limit);
      case 'exa':
        return searchExa(apiKey!, query, limit);
      default:
        return { error: `Unknown search provider: ${config.webSearchProvider}` };
    }
  } catch (err) {
    throw new Error(`Web search failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

async function searchTavily(apiKey: string, query: string, maxResults: number) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: 'basic' }),
  });
  if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
  const data = (await res.json()) as { results: Array<{ title: string; url: string; content: string }> };
  return { results: data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 500) })) };
}

async function searchBrave(apiKey: string, query: string, maxResults: number) {
  const params = new URLSearchParams({ q: query, count: String(maxResults) });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey },
  });
  if (!res.ok) throw new Error(`Brave error: ${res.status}`);
  const data = (await res.json()) as {
    web?: { results: Array<{ title: string; url: string; description: string }> };
  };
  return {
    results: (data.web?.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description?.slice(0, 500),
    })),
  };
}

async function searchSerper(apiKey: string, query: string, maxResults: number) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: maxResults }),
  });
  if (!res.ok) throw new Error(`Serper error: ${res.status}`);
  const data = (await res.json()) as { organic: Array<{ title: string; link: string; snippet: string }> };
  return {
    results: (data.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet?.slice(0, 500) })),
  };
}

async function searchSearxng(baseUrl: string, query: string, maxResults: number) {
  if (!baseUrl || isPrivateUrl(baseUrl)) {
    return { error: 'SearXNG base URL is not configured or points to a private address' };
  }
  const url = baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ q: query, format: 'json', pageno: '1' });
  const res = await fetch(`${url}/search?${params}`);
  if (!res.ok) throw new Error(`SearXNG error: ${res.status}`);
  const data = (await res.json()) as { results: Array<{ title: string; url: string; content: string }> };
  return {
    results: data.results
      .slice(0, maxResults)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 500) })),
  };
}

async function searchExa(apiKey: string, query: string, maxResults: number) {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, num_results: maxResults, type: 'auto' }),
  });
  if (!res.ok) throw new Error(`Exa error: ${res.status}`);
  const data = (await res.json()) as {
    results: Array<{ title: string; url: string; text?: string; author?: string }>;
  };
  return { results: data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.text?.slice(0, 500) })) };
}
