// background.js - Chrome Extension Service Worker
import { extractCitationsFromPdf } from './extractor.js';

// Cache key helper
function getCacheKey(url) {
  return `pdf_cache_${url.split('#')[0]}`; // Strip hash destinations
}

// Listen for messages from content scripts (e.g. for existing web-embedded viewers)
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
        // Cache miss: download the PDF and run the modular extraction pipeline
        console.log(`Cache miss for PDF: ${pdfUrl}. Downloading and parsing...`);
        
        fetch(pdfUrl)
          .then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.arrayBuffer();
          })
          .then(async (arrayBuffer) => {
            const pdfData = new Uint8Array(arrayBuffer);
            
            // Invoke our modular extractor
            const parsed = await extractCitationsFromPdf(pdfData, {
              workerSrc: chrome.runtime.getURL('pdf.worker.js') // Load worker locally from extension package
            });

            // Save parsing output to storage cache
            const cacheObj = {};
            cacheObj[cacheKey] = parsed;
            chrome.storage.local.set(cacheObj, () => {
              console.log(`Saved parsed citations to cache for: ${pdfUrl}`);
            });

            const match = parsed.inlineLinks.find(l => l.destName === destKey);
            sendResponse({ success: true, url: match ? match.targetUrl : null });
          })
          .catch(err => {
            console.error('Failed to download/parse PDF in background worker:', err);
            sendResponse({ success: false, error: err.message });
          });
      }
    });

    return true; // Keep the message channel open for async response
  }
});

// Listen for tab updates to intercept navigation to PDF files and redirect to custom viewer
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Read from changeInfo.url first, fallback to tab.url to handle new tabs/creation updates
  const url = changeInfo.url || tab.url;
  if (!url) return;

  const urlWithoutQuery = url.split('?')[0].split('#')[0];
  const viewerPrefix = chrome.runtime.getURL('viewer.html');
  
  // Check if the URL is a PDF file and not already loaded in our custom viewer
  if (urlWithoutQuery.toLowerCase().endsWith('.pdf') && !url.startsWith(viewerPrefix)) {
    console.log(`Redirecting tab ${tabId} to custom PDF viewer: ${url}`);
    const viewerUrl = `${viewerPrefix}?file=${encodeURIComponent(url)}`;
    chrome.tabs.update(tabId, { url: viewerUrl });
  }
});
