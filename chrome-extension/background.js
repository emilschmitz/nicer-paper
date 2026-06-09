// background.js - Chrome Extension Service Worker
import { extractCitationsFromPdf } from './extractor.js';

// Cache key helper
function getCacheKey(url) {
  return `pdf_cache_${url.split('#')[0]}`; // Strip hash destinations
}

// Listen for messages from content scripts and viewer pages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getLinkForCitation') {
    const { destKey, pdfUrl } = request;
    const cacheKey = getCacheKey(pdfUrl);

    chrome.storage.local.get([cacheKey], (result) => {
      const cachedData = result[cacheKey];

      if (cachedData) {
        // Cache hit
        const match = cachedData.inlineLinks.find(l => l.destName === destKey);
        sendResponse({ success: true, url: match ? match.targetUrl : null });
      } else {
        // Cache miss
        fetchAndExtract(pdfUrl)
          .then(parsed => {
            const match = parsed.inlineLinks.find(l => l.destName === destKey);
            sendResponse({ success: true, url: match ? match.targetUrl : null });
          })
          .catch(err => {
            sendResponse({ success: false, error: err.message });
          });
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
        // Cache hit
        sendResponse({ success: true, data: cachedData });
      } else {
        // Cache miss
        fetchAndExtract(pdfUrl)
          .then(parsed => {
            sendResponse({ success: true, data: parsed });
          })
          .catch(err => {
            sendResponse({ success: false, error: err.message });
          });
      }
    });
    return true; // Keep the message channel open for async response
  }
});

// Helper: Download and extract citations from a PDF URL
async function fetchAndExtract(pdfUrl) {
  console.log(`Downloading and parsing PDF: ${pdfUrl}...`);
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  
  const arrayBuffer = await res.arrayBuffer();
  const pdfData = new Uint8Array(arrayBuffer);
  
  // Invoke our modular extractor
  const parsed = await extractCitationsFromPdf(pdfData, {
    workerSrc: chrome.runtime.getURL('pdf.worker.js')
  });

  // Save to storage cache
  const cacheKey = getCacheKey(pdfUrl);
  const cacheObj = {};
  cacheObj[cacheKey] = parsed;
  await chrome.storage.local.set(cacheObj);
  console.log(`Saved parsed citations to cache for: ${pdfUrl}`);
  return parsed;
}

// Listen for tab updates to intercept navigation to PDF files and redirect to custom viewer
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Read from changeInfo.url first, fallback to tab.url to handle new tabs/creation updates
  const url = changeInfo.url || tab.url;
  if (!url) return;

  const viewerPrefix = chrome.runtime.getURL('pdfjs/web/viewer.html');
  if (url.startsWith(viewerPrefix)) return;

  const DEFAULT_PATTERNS = [
    '\\.pdf(?:\\?|#|$)',
    'arxiv\\.org/pdf/\\d+'
  ];

  // Retrieve patterns from storage
  chrome.storage.local.get(['interceptPatterns'], (result) => {
    let patterns = result.interceptPatterns;
    if (!patterns) {
      patterns = DEFAULT_PATTERNS;
      chrome.storage.local.set({ interceptPatterns: patterns });
    }

    // Check if URL matches any of the configured regex patterns
    const shouldIntercept = patterns.some(patternStr => {
      try {
        const regex = new RegExp(patternStr, 'i');
        return regex.test(url);
      } catch (err) {
        console.error(`Invalid regex pattern: ${patternStr}`, err);
        return false;
      }
    });

    if (shouldIntercept) {
      console.log(`Redirecting tab ${tabId} to custom PDF viewer: ${url}`);
      const viewerUrl = `${viewerPrefix}?file=${encodeURIComponent(url)}`;
      chrome.tabs.update(tabId, { url: viewerUrl });
    }
  });
});
