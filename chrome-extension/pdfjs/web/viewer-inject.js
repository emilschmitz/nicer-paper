import { extractCitationsFromPdf } from '../../extractor.js';
import { Config } from '../../config.js';

console.log('Citation Finder: Viewer Inject starting...');

let tooltipPrefs = {
  showAuthors: true,
  showYear: true,
  showTitle: true,
  showVenue: true,
  showAbstract: true,
  showOpenPaper: true,
  showCopyLink: true
};

chrome.storage.local.get(['tooltipPreferences'], (result) => {
  if (result.tooltipPreferences) {
    tooltipPrefs = { ...tooltipPrefs, ...result.tooltipPreferences };
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.tooltipPreferences) {
    tooltipPrefs = { ...tooltipPrefs, ...changes.tooltipPreferences.newValue };
  }
});
window.TEST_LOADED = true;
let extractionResult = null;
let tooltipEl = null;
let hoverTimeout = null;
let hideTimeout = null;
let currentDestKey = null;
let currentTargetEl = null;
let currentUrl = null;

// Initialize tooltip
function createTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'citation-tooltip';
  tooltipEl.className = 'cit-tooltip-hidden';
  tooltipEl.style.position = 'fixed';
  tooltipEl.style.zIndex = '999999';
  document.body.appendChild(tooltipEl);

  tooltipEl.addEventListener('mouseenter', () => {
    clearHideTimeout();
  });
  
  tooltipEl.addEventListener('mouseleave', () => {
    startHideTimeout();
  });
}

function clearHideTimeout() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
}

function startHideTimeout() {
  clearHideTimeout();
  hideTimeout = setTimeout(() => {
    hideTooltip();
  }, 250);
}

function formatAuthorsForDisplay(authorsStr) {
  if (!authorsStr) return '';
  const parts = authorsStr.split(/\s+and\s+/i);
  if (parts.length > 2) {
    return `${parts[0]} et al.`;
  }
  return authorsStr;
}

function updateTooltipWithEnrichedData(metadata, abstract) {
  if (!tooltipEl) return;
  
  const authorsEl = tooltipEl.querySelector('.cit-tooltip-authors');
  const yearEl = tooltipEl.querySelector('.cit-tooltip-year');
  const titleEl = tooltipEl.querySelector('.cit-tooltip-title');
  const venueEl = tooltipEl.querySelector('.cit-tooltip-venue');
  const abstractEl = tooltipEl.querySelector('.cit-tooltip-abstract');
  
  if (metadata) {
    if (authorsEl && metadata.authors) {
      authorsEl.innerText = formatAuthorsForDisplay(metadata.authors);
      authorsEl.title = metadata.authors;
    }
    if (yearEl && metadata.year) yearEl.innerText = `(${metadata.year})`;
    if (titleEl && metadata.title) titleEl.innerText = `"${metadata.title}"`;
    if (venueEl && metadata.venue) venueEl.innerText = metadata.venue;
  }
  
  if (abstractEl) {
    abstractEl.innerText = abstract || 'No abstract preview available.';
    abstractEl.classList.remove('cit-loading');
  }

  repositionTooltip();
}

function repositionTooltip() {
  if (!tooltipEl || !currentTargetEl) return;
  
  const rect = currentTargetEl.getBoundingClientRect();
  const top = rect.top - 8;
  const left = rect.left + (rect.width / 2);

  const tooltipRect = tooltipEl.getBoundingClientRect();
  tooltipEl.style.top = `${top - tooltipRect.height}px`;
  tooltipEl.style.left = `${left - (tooltipRect.width / 2)}px`;
}

// Show tooltip at coordinate
function showTooltip(anchorEl, destKey, url, metadata, abstract) {
  if (!tooltipEl) createTooltip();
  
  currentTargetEl = anchorEl;
  currentDestKey = destKey;
  currentUrl = url;
  tooltipEl.dataset.destKey = destKey;

  const rawAuthors = metadata?.authors || '';
  let authors = (tooltipPrefs.showAuthors && rawAuthors) ? formatAuthorsForDisplay(rawAuthors) : '';
  if (tooltipPrefs.showAuthors && !authors && !rawAuthors) {
    authors = 'Unknown Authors';
  }
  const year = (tooltipPrefs.showYear && metadata?.year) ? metadata.year : '';
  let title = (tooltipPrefs.showTitle) ? (metadata?.title || 'Citation Reference') : '';
  const venue = (tooltipPrefs.showVenue && metadata?.venue) ? metadata.venue : '';

  let headerHtml = '';
  if (authors || year) {
    headerHtml = `
      <div class="cit-tooltip-header">
        ${authors ? `<span class="cit-tooltip-authors" title="${rawAuthors || authors}">${authors}</span>` : ''}
        ${year ? `<span class="cit-tooltip-year">(${year})</span>` : ''}
      </div>
    `;
  }

  let titleHtml = '';
  if (title) {
    titleHtml = `<div class="cit-tooltip-title">"${title}"</div>`;
  }

  let venueHtml = '';
  if (venue) {
    venueHtml = `<div class="cit-tooltip-venue">${venue}</div>`;
  }

  let abstractHtml = '';
  if (tooltipPrefs.showAbstract && url) {
    if (abstract) {
      abstractHtml = `<div class="cit-tooltip-abstract">${abstract}</div>`;
    } else {
      abstractHtml = `<div class="cit-tooltip-abstract cit-loading">Loading abstract...</div>`;
    }
  }

  let footerHtml = '';
  if (url) {
    const showOpen = tooltipPrefs.showOpenPaper;
    const showCopy = tooltipPrefs.showCopyLink;
    if (showOpen || showCopy) {
      footerHtml = `
        <div class="cit-tooltip-footer">
          ${showOpen ? `<a class="cit-tooltip-url-btn" href="${url}" target="_blank" rel="noopener noreferrer">Open Paper</a>` : ''}
          ${showCopy ? `<span class="cit-tooltip-action-btn copy-btn">Copy Link</span>` : ''}
        </div>
      `;
    }
  } else {
    footerHtml = `
      <div class="cit-tooltip-footer">
        <span class="cit-tooltip-label">Local citation preview</span>
      </div>
    `;
  }

  if (!headerHtml && !titleHtml && !venueHtml && !abstractHtml) {
    titleHtml = `<div class="cit-tooltip-title">Citation Reference</div>`;
  }

  tooltipEl.innerHTML = `
    <div class="cit-tooltip-content">
      ${headerHtml}
      ${titleHtml}
      ${venueHtml}
      ${abstractHtml}
      ${footerHtml}
    </div>
  `;

  if (url && tooltipPrefs.showCopyLink) {
    const copyBtn = tooltipEl.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(url);
        copyBtn.innerText = 'Copied!';
        setTimeout(() => { copyBtn.innerText = 'Copy Link'; }, 2000);
      });
    }
  }

  tooltipEl.className = 'cit-tooltip-visible';
  repositionTooltip();
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.className = 'cit-tooltip-hidden';
    currentDestKey = null;
    currentTargetEl = null;
    currentUrl = null;
  }
}

// In-memory cache for hovered citation responses to avoid IPC message roundtrips on repeated hovers
const citationMemoryCache = new Map();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateTooltipMetadata') {
    const { destKey, metadata, abstract } = message;
    
    // Update in-memory cache
    const cacheKey = `${pdfUrl}::${destKey}`;
    if (citationMemoryCache.has(cacheKey)) {
      const cached = citationMemoryCache.get(cacheKey);
      cached.metadata = metadata;
      cached.abstract = abstract;
    } else {
      citationMemoryCache.set(cacheKey, {
        url: currentUrl,
        metadata,
        abstract
      });
    }

    if (currentDestKey === destKey) {
      updateTooltipWithEnrichedData(metadata, abstract);
    }
  }
});


// Helper: Retrieve raw PDF bytes directly from PDF.js viewer document memory to avoid duplicate downloads
function getPdfDataFromViewer() {
  return new Promise((resolve, reject) => {
    const tryResolve = () => {
      const app = window.PDFViewerApplication;
      if (app && app.pdfDocument) {
        app.pdfDocument.getData()
          .then(resolve)
          .catch(reject);
        cleanup();
        return true;
      }
      return false;
    };

    const handleEvent = () => {
      tryResolve();
    };

    let checkInterval = setInterval(() => {
      const app = window.PDFViewerApplication;
      if (app && app.eventBus) {
        clearInterval(checkInterval);
        checkInterval = null;
        app.eventBus.on('documentloaded', handleEvent);
      }
    }, 50);

    const cleanup = () => {
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      window.removeEventListener('documentloaded', handleEvent);
      document.removeEventListener('documentloaded', handleEvent);
      document.removeEventListener('pagerendered', handleEvent);
      const app = window.PDFViewerApplication;
      if (app && app.eventBus) {
        app.eventBus.off('documentloaded', handleEvent);
      }
    };

    if (tryResolve()) return;

    window.addEventListener('documentloaded', handleEvent);
    document.addEventListener('documentloaded', handleEvent);
    document.addEventListener('pagerendered', handleEvent);

    // Timeout safety fallback
    setTimeout(() => {
      if (!tryResolve()) {
        cleanup();
        reject(new Error('Timeout waiting for PDF.js document to load'));
      }
    }, Config.PDF.LOAD_TIMEOUT_MS);
  });
}

// Get query parameters
const urlParams = new URLSearchParams(window.location.search);
const pdfUrl = urlParams.get('file');

if (pdfUrl) {
  const cacheKey = `pdf_cache_${pdfUrl.split('#')[0]}`;
  
  // Try loading from local storage cache via background to ensure LRU timestamps are handled
  chrome.runtime.sendMessage({ action: 'getCachedCitationsOnly', pdfUrl }, async (response) => {
    if (response && response.success && response.data) {
      extractionResult = response.data;
      window.extractionResult = extractionResult;
      console.log('Citation Finder: Loaded citations from cache.', extractionResult);
      applyOverlaysToAllRenderedPages();
    } else {
      console.log('Citation Finder: Cache miss. Extracting citations locally in viewer tab...');
      try {
        console.log('Citation Finder: Retrieving PDF bytes from viewer memory...');
        const pdfData = await getPdfDataFromViewer();
        console.log('Citation Finder: Successfully retrieved PDF bytes from memory (0 network overhead!).');

        // Run local extraction
        extractionResult = await extractCitationsFromPdf(pdfData, {
          workerSrc: '../../pdf.worker.js',
          onProgress: (percent) => {
            console.log(`Citation Finder: Extraction progress ${percent}%`);
            chrome.runtime.sendMessage({
              action: 'reportExtractionProgress',
              pdfUrl: pdfUrl,
              progress: percent
            });
          }
        });
        window.extractionResult = extractionResult;

        console.log('Citation Finder: Local extraction completed.', extractionResult);

        // Save to cache via background to update timestamps and invoke LRU pruning
        chrome.runtime.sendMessage({
          action: 'saveExtractedCitations',
          pdfUrl: pdfUrl,
          data: extractionResult
        });

        applyOverlaysToAllRenderedPages();
      } catch (err) {
        window.extractionError = err.message + '\n' + err.stack;
        console.error('Citation Finder: Local extraction failed:', err);
      }
    }
  });
}

// Apply overlays to pages that are already rendered
function applyOverlaysToAllRenderedPages() {
  if (!extractionResult) return;
  const pages = document.querySelectorAll('.page');
  pages.forEach(pageDiv => {
    const pageNum = parseInt(pageDiv.getAttribute('data-page-number'));
    if (pageNum) {
      applyCitationOverlaysToPage(pageNum, pageDiv);
    }
  });
}

// Listen to PDF.js page rendering events
document.addEventListener('pagerendered', (e) => {
  const pageNum = e.detail?.pageNumber || e.pageNumber;
  if (!pageNum) return;
  const pageDiv = document.querySelector(`.page[data-page-number="${pageNum}"]`);
  if (pageDiv) {
    applyCitationOverlaysToPage(pageNum, pageDiv);
  }
});

function applyCitationOverlaysToPage(pageNum, pageDiv) {
  if (!extractionResult || !extractionResult.inlineLinks) return;

  const existingOverlays = pageDiv.querySelectorAll('.cit-link-overlay');
  existingOverlays.forEach(el => el.remove());

  const pageView = window.PDFViewerApplication?.pdfViewer?.getPageView(pageNum - 1);
  if (!pageView) return;
  const viewport = pageView.viewport;

  const pageLinks = extractionResult.inlineLinks.filter(l => l.sourcePage === pageNum);
  pageLinks.forEach(link => {
    const rect = viewport.convertToViewportRectangle(link.sourceRect);
    
    const padding = 1.5;
    const x = Math.min(rect[0], rect[2]) - padding;
    const y = Math.min(rect[1], rect[3]) - padding;
    const w = Math.abs(rect[2] - rect[0]) + (padding * 2);
    const h = Math.abs(rect[3] - rect[1]) + (padding * 2);

    const overlay = document.createElement('a');
    overlay.className = 'link-overlay cit-link-overlay';
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y}px`;
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
    overlay.href = '#'; // Let it default to empty anchor to avoid external navigation on click

    overlay.addEventListener('mouseover', () => {
      clearTimeout(hoverTimeout);
      clearHideTimeout();
      
      if (currentDestKey === link.destName) return;

      hoverTimeout = setTimeout(() => {
        const cacheKey = `${pdfUrl}::${link.destName}`;
        if (citationMemoryCache.has(cacheKey)) {
          const cached = citationMemoryCache.get(cacheKey);
          showTooltip(overlay, link.destName, cached.url, cached.metadata, cached.abstract);
          return;
        }

        // Query background to trigger async metadata fetch / get current cache
        chrome.runtime.sendMessage(
          { action: 'getLinkForCitation', destKey: link.destName, pdfUrl: pdfUrl },
          (response) => {
            if (response && response.success) {
              const metadata = response.metadata || link.targetMetadata;
              // Cache in-memory
              citationMemoryCache.set(cacheKey, {
                url: response.url,
                metadata: metadata,
                abstract: response.abstract
              });
              showTooltip(overlay, link.destName, response.url, metadata, response.abstract);
            } else {
              // Fallback to local heuristic metadata
              showTooltip(overlay, link.destName, link.targetUrl, link.targetMetadata, null);
            }
          }
        );
      }, Config.TOOLTIP.SHOW_DELAY_MS);
    });

    overlay.addEventListener('mouseout', () => {
      clearTimeout(hoverTimeout);
      startHideTimeout();
    });

    // Handle click pass-through: clicking the overlay triggers the native jump link underneath
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      
      overlay.style.pointerEvents = 'none';
      const underlyingEl = document.elementFromPoint(e.clientX, e.clientY);
      if (underlyingEl && typeof underlyingEl.click === 'function') {
        underlyingEl.click();
      }
      overlay.style.pointerEvents = 'auto';
    });

    pageDiv.appendChild(overlay);
  });
}

// Init page
// Note: We don't need to call injectStyles() because we added it to viewer.html manually
createTooltip();
console.log('Citation Tooltips Extension initialized.');
