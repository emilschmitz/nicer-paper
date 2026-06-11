// background.js - Chrome Extension Service Worker
import { Config } from './config.js';

console.log('[Background] Service worker starting...');
console.log('[Background] Imports successful.');

// In-memory map to store current parsing progress of PDF URLs
const activeParsings = new Map();

// Initialize whitelist, blacklist, and tooltip preferences storage if not already present
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['whitelistPatterns', 'blacklistPatterns', 'tooltipPreferences'], (result) => {
    if (result.whitelistPatterns === undefined) {
      chrome.storage.local.set({ whitelistPatterns: [] });
    }
    if (result.blacklistPatterns === undefined) {
      chrome.storage.local.set({ blacklistPatterns: [] });
    }
    if (result.tooltipPreferences === undefined) {
      chrome.storage.local.set({
        tooltipPreferences: {
          showAuthors: true,
          showYear: true,
          showTitle: true,
          showVenue: true,
          showAbstract: true,
          showOpenPaper: true,
          showCopyLink: true
        }
      });
    }
  });
});

// Cache key helper
function getCacheKey(url) {
  return `pdf_cache_${url.split('#')[0]}`; // Strip hash destinations
}

// Extract DOI from a URL
function extractDoi(url) {
  if (!url) return null;
  const doiRegex = /(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/;
  const match = url.match(doiRegex);
  return match ? match[1] : null;
}

// Extract arXiv ID from a URL
function extractArxivId(url) {
  if (!url) return null;
  const arxivRegex = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i;
  const match = url.match(arxivRegex);
  return match ? match[1] : null;
}

// Fetch metadata from arXiv XML API
async function fetchArxivMetadata(arxivId) {
  console.log(`[arXiv API] Querying metadata for ID: ${arxivId}...`);
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': `${Config.API.APP_NAME} (mailto:${Config.API.CONTACT_EMAIL})`
    }
  });
  if (!res.ok) throw new Error(`arXiv API HTTP error: ${res.status}`);
  const xml = await res.text();

  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entryMatch) return null;
  
  const entryXml = entryMatch[1];
  const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/);
  const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);
  const publishedMatch = entryXml.match(/<published>([\s\S]*?)<\/published>/);

  const authors = [];
  const authorRegex = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let match;
  while ((match = authorRegex.exec(entryXml)) !== null) {
    authors.push(match[1].trim());
  }

  let title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
  let abstract = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : null;
  let year = publishedMatch ? publishedMatch[1].substring(0, 4) : null;

  // Format authors to "Author 1 and Author 2" or "Author 1 et al."
  let authorsStr = authors.join(' and ');

  return {
    metadata: {
      authors: authorsStr || null,
      title: title || null,
      venue: 'arXiv Preprint',
      year: year || null
    },
    abstract: abstract || null
  };
}

// Fetch metadata from CrossRef JSON API politely
async function fetchCrossRefMetadata(doi) {
  console.log(`[CrossRef API] Querying metadata for DOI: ${doi}...`);
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;

  // CrossRef requests a polite header containing contact information to access the polite pool
  const headers = {
    'User-Agent': `${Config.API.APP_NAME} (mailto:${Config.API.CONTACT_EMAIL})`
  };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`CrossRef API HTTP error: ${res.status}`);
  }

  const data = await res.json();
  const item = data.message;
  if (!item) return null;

  let authorsStr = '';
  if (item.author && Array.isArray(item.author)) {
    authorsStr = item.author.map(a => {
      if (a.given && a.family) return `${a.given} ${a.family}`;
      if (a.family) return a.family;
      if (a.name) return a.name;
      return '';
    }).filter(Boolean).join(' and ');
  }

  let title = '';
  if (item.title && Array.isArray(item.title) && item.title.length > 0) {
    title = item.title[0];
  }

  let venue = '';
  if (item['container-title'] && Array.isArray(item['container-title']) && item['container-title'].length > 0) {
    venue = item['container-title'][0];
  } else if (item.publisher) {
    venue = item.publisher;
  }

  let year = '';
  if (item.published && item.published['date-parts'] && item.published['date-parts'][0]) {
    year = String(item.published['date-parts'][0][0]);
  } else if (item.created && item.created['date-parts'] && item.created['date-parts'][0]) {
    year = String(item.created['date-parts'][0][0]);
  }

  let abstract = null;
  if (item.abstract) {
    // Clean XML/JATS tags from CrossRef abstract
    abstract = item.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (abstract.toLowerCase().startsWith('abstract')) {
      abstract = abstract.substring(8).trim();
    }
  }

  return {
    metadata: {
      authors: authorsStr || null,
      title: title || null,
      venue: venue || null,
      year: year || null
    },
    abstract: abstract || null
  };
}

// Fetch metadata from arXiv or CrossRef depending on the target URL type
async function fetchPaperMetadata(targetUrl) {
  const arxivId = extractArxivId(targetUrl);
  if (arxivId) {
    return fetchArxivMetadata(arxivId);
  }

  const doi = extractDoi(targetUrl);
  if (doi) {
    return fetchCrossRefMetadata(doi);
  }

  return null;
}

// Update local storage cache with newly fetched API metadata/abstract
function updateCacheWithEnrichedMetadata(pdfUrl, destKey, enriched) {
  const cacheKey = getCacheKey(pdfUrl);
  chrome.storage.local.get([cacheKey], (result) => {
    const cachedData = result[cacheKey];
    if (cachedData) {
      const idx = cachedData.inlineLinks.findIndex(l => l.destName === destKey);
      if (idx !== -1) {
        cachedData.inlineLinks[idx].targetMetadata = enriched.metadata;
        cachedData.inlineLinks[idx].targetAbstract = enriched.abstract;
        
        const cacheObj = {};
        cacheObj[cacheKey] = cachedData;
        chrome.storage.local.set(cacheObj);
      }
    }
  });
}

// Fetch metadata and cache it globally to prevent duplicate network calls across files
async function getPaperMetadata(targetUrl) {
  if (!targetUrl) return null;
  const cleanUrl = targetUrl.split('#')[0];
  const metaKey = `meta_cache_${cleanUrl}`;

  try {
    const result = await new Promise(resolve => chrome.storage.local.get([metaKey], resolve));
    if (result[metaKey]) {
      console.log(`[Metadata Cache] Hit for ${cleanUrl}`);
      const entry = result[metaKey];
      entry.lastAccessed = Date.now();
      const updateObj = {};
      updateObj[metaKey] = entry;
      await new Promise(resolve => chrome.storage.local.set(updateObj, resolve));
      return entry.data;
    }
  } catch (err) {
    console.error('Error checking global metadata cache:', err);
  }

  // Fetch from APIs if cache miss
  const enriched = await fetchPaperMetadata(targetUrl);
  if (enriched) {
    try {
      const saveObj = {};
      saveObj[metaKey] = {
        data: enriched,
        lastAccessed: Date.now()
      };
      await new Promise(resolve => chrome.storage.local.set(saveObj, resolve));
      pruneMetadataCache().catch(console.error);
    } catch (err) {
      console.error('Error saving to global metadata cache:', err);
    }
  }
  return enriched;
}

// Asynchronously fetch API metadata and abstract, then broadcast to content script
async function enrichMetadata(targetUrl, destKey, pdfUrl, tabId) {
  try {
    const enriched = await getPaperMetadata(targetUrl);
    if (enriched) {
      const targetTabId = tabId || await (async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return tab?.id;
      })();
      
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, {
          action: 'updateTooltipMetadata',
          destKey,
          metadata: enriched.metadata,
          abstract: enriched.abstract
        });
      }
      // Write back to cache
      updateCacheWithEnrichedMetadata(pdfUrl, destKey, enriched);
    }
  } catch (err) {
    console.error('Failed to enrich metadata:', err);
  }
}

// Listen for messages from content scripts and viewer pages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getLinkForCitation') {
    const { destKey, pdfUrl } = request;
    const cacheKey = getCacheKey(pdfUrl);

    chrome.storage.local.get([cacheKey], (result) => {
      const cachedData = result[cacheKey];

      if (cachedData) {
        updateLastAccessed(cacheKey);
        const match = cachedData.inlineLinks.find(l => l.destName === destKey);
        if (match) {
          const targetUrl = match.targetUrl;
          let metadata = match.targetMetadata || null;
          let abstract = match.targetAbstract || null;

          // Helper async function to process local cache hit, checking global metadata cache if needed
          const processHit = async () => {
            if (targetUrl && (!abstract || !metadata)) {
              try {
                const cleanUrl = targetUrl.split('#')[0];
                const metaKey = `meta_cache_${cleanUrl}`;
                const metaResult = await new Promise(resolve => chrome.storage.local.get([metaKey], resolve));
                if (metaResult[metaKey]) {
                  const enriched = metaResult[metaKey].data;
                  metadata = enriched.metadata;
                  abstract = enriched.abstract;
                  updateCacheWithEnrichedMetadata(pdfUrl, destKey, enriched);
                }
              } catch (e) {
                console.error('Error looking up global metadata cache:', e);
              }
            }
            sendResponse({ success: true, url: targetUrl, metadata, abstract });
            if (targetUrl && !abstract) {
              chrome.storage.local.get(['tooltipPreferences'], (res) => {
                const prefs = res.tooltipPreferences || {};
                if (prefs.showAbstract !== false) {
                  enrichMetadata(targetUrl, destKey, pdfUrl, sender.tab?.id);
                }
              });
            }
          };
          processHit();
        } else {
          sendResponse({ success: true, url: null, metadata: null, abstract: null });
        }
      } else {
        // Cache miss - the custom viewer tab handles local extraction and will save it shortly
        sendResponse({ success: true, url: null, metadata: null, abstract: null });
      }
    });
    return true; // Keep the message channel open for async response
  }

  if (request.action === 'getExtractedCitations') {
    const { pdfUrl } = request;
    const cacheKey = getCacheKey(pdfUrl);

    chrome.storage.local.get([cacheKey], (result) => {
      const cachedData = result[cacheKey];

      if (cachedData) {
        updateLastAccessed(cacheKey);
        sendResponse({ success: true, data: cachedData });
      } else {
        sendResponse({ success: false, error: 'Citations not extracted yet.' });
      }
    });
    return true;
  }

  if (request.action === 'getCachedCitationsOnly') {
    const { pdfUrl } = request;
    const cacheKey = getCacheKey(pdfUrl);
    chrome.storage.local.get([cacheKey], (result) => {
      const cachedData = result[cacheKey];
      if (cachedData) {
        updateLastAccessed(cacheKey);
        sendResponse({ success: true, data: cachedData });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }

  if (request.action === 'saveExtractedCitations') {
    const { pdfUrl, data } = request;
    activeParsings.delete(pdfUrl); // Done parsing!
    const cacheKey = getCacheKey(pdfUrl);
    const cacheObj = {};
    cacheObj[cacheKey] = {
      ...data,
      lastAccessed: Date.now()
    };
    chrome.storage.local.set(cacheObj, () => {
      console.log(`Saved extracted citations via saveExtractedCitations for: ${pdfUrl}`);
      pruneCache().catch(console.error);
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'reportExtractionProgress') {
    const { pdfUrl, progress } = request;
    activeParsings.set(pdfUrl, progress);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'getExtractionProgress') {
    const { pdfUrl } = request;
    const progress = activeParsings.has(pdfUrl) ? activeParsings.get(pdfUrl) : null;
    sendResponse({ success: true, progress });
    return true;
  }
});

function isPdfUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.endsWith('.pdf');
  } catch (err) {
    const cleanUrl = url.split(/[?#]/)[0].toLowerCase();
    return cleanUrl.endsWith('.pdf');
  }
}

function shouldInterceptUrl(url, whitelist, blacklist) {
  if (blacklist && blacklist.length > 0) {
    const isBlacklisted = blacklist.some(patternStr => {
      try {
        const regex = new RegExp(patternStr, 'i');
        return regex.test(url);
      } catch (err) {
        console.error(`Invalid blacklist regex: ${patternStr}`, err);
        return false;
      }
    });
    if (isBlacklisted) return false;
  }

  if (whitelist && whitelist.length > 0) {
    const isWhitelisted = whitelist.some(patternStr => {
      try {
        const regex = new RegExp(patternStr, 'i');
        return regex.test(url);
      } catch (err) {
        console.error(`Invalid whitelist regex: ${patternStr}`, err);
        return false;
      }
    });
    return isWhitelisted;
  }

  return true;
}

// 1. Intercept via webRequest header detection (for online PDFs like arXiv or direct downloads)
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== 'main_frame') return;

    const url = details.url;
    const viewerPrefix = chrome.runtime.getURL('pdfjs/web/viewer.html');
    if (url.startsWith(viewerPrefix)) return;

    if (!details.responseHeaders) return;
    const contentTypeHeader = details.responseHeaders.find(
      h => h.name.toLowerCase() === 'content-type'
    );
    if (!contentTypeHeader) return;

    const contentType = contentTypeHeader.value.toLowerCase();
    if (contentType.includes('application/pdf')) {
      chrome.storage.local.get(['whitelistPatterns', 'blacklistPatterns'], (result) => {
        const whitelist = result.whitelistPatterns || [];
        const blacklist = result.blacklistPatterns || [];

        if (shouldInterceptUrl(url, whitelist, blacklist)) {
          console.log(`[onHeadersReceived] Redirecting tab ${details.tabId} to custom PDF viewer: ${url}`);
          const viewerUrl = `${viewerPrefix}?file=${encodeURIComponent(url)}`;
          chrome.tabs.update(details.tabId, { url: viewerUrl });
        }
      });
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders"]
);

// 2. Intercept tab updates (fallback for local file:/// URLs or immediate navigation matching)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (!url) return;

  const viewerPrefix = chrome.runtime.getURL('pdfjs/web/viewer.html');
  if (url.startsWith(viewerPrefix)) return;

  if (isPdfUrl(url)) {
    chrome.storage.local.get(['whitelistPatterns', 'blacklistPatterns'], (result) => {
      const whitelist = result.whitelistPatterns || [];
      const blacklist = result.blacklistPatterns || [];

      if (shouldInterceptUrl(url, whitelist, blacklist)) {
        console.log(`[onUpdated] Redirecting tab ${tabId} to custom PDF viewer: ${url}`);
        const viewerUrl = `${viewerPrefix}?file=${encodeURIComponent(url)}`;
        chrome.tabs.update(tabId, { url: viewerUrl });
      }
    });
  }
});

// Update access timestamp for LRU cache policy
function updateLastAccessed(cacheKey) {
  chrome.storage.local.get([cacheKey], (result) => {
    const cachedData = result[cacheKey];
    if (cachedData) {
      cachedData.lastAccessed = Date.now();
      const obj = {};
      obj[cacheKey] = cachedData;
      chrome.storage.local.set(obj);
    }
  });
}

// Prune storage to avoid bloated local cache files exceeding reasonable limits (max 2000 papers)
async function pruneCache() {
  const MAX_CACHED_PAPERS = 2000;
  const allStorage = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
  const cacheKeys = Object.keys(allStorage).filter(k => k.startsWith('pdf_cache_'));
  
  if (cacheKeys.length > MAX_CACHED_PAPERS) {
    console.log(`[Cache Manager] Pruning cache. Size: ${cacheKeys.length} PDFs (Limit: ${MAX_CACHED_PAPERS})`);
    const entries = cacheKeys.map(key => {
      const data = allStorage[key];
      return {
        key,
        lastAccessed: data.lastAccessed || 0
      };
    });
    
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    const numToDelete = cacheKeys.length - MAX_CACHED_PAPERS;
    const keysToDelete = entries.slice(0, numToDelete).map(e => e.key);
    
    await new Promise((resolve) => chrome.storage.local.remove(keysToDelete, resolve));
    console.log(`[Cache Manager] Successfully evicted ${numToDelete} old cache entries.`);
  }
}

// Prune global metadata cache to avoid bloating
async function pruneMetadataCache() {
  const MAX_CACHED_METADATA = Config.CACHE.MAX_CACHED_METADATA;
  const allStorage = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
  const metaKeys = Object.keys(allStorage).filter(k => k.startsWith('meta_cache_'));
  
  if (metaKeys.length > MAX_CACHED_METADATA) {
    console.log(`[Metadata Cache Manager] Pruning. Size: ${metaKeys.length} entries (Limit: ${MAX_CACHED_METADATA})`);
    const entries = metaKeys.map(key => {
      const data = allStorage[key];
      return {
        key,
        lastAccessed: (data && data.lastAccessed) || 0
      };
    });
    
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    const numToDelete = metaKeys.length - MAX_CACHED_METADATA;
    const keysToDelete = entries.slice(0, numToDelete).map(e => e.key);
    
    await new Promise((resolve) => chrome.storage.local.remove(keysToDelete, resolve));
    console.log(`[Metadata Cache Manager] Successfully evicted ${numToDelete} old metadata cache entries.`);
  }
}
