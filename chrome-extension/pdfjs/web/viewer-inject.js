import { extractCitationsFromPdf } from '../../extractor.js';

let extractionResult = null;
let tooltipEl = null;

// Initialize tooltip
function createTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'citation-tooltip';
  tooltipEl.className = 'cit-tooltip-hidden';
  tooltipEl.style.position = 'fixed';
  document.body.appendChild(tooltipEl);
}

function showTooltip(anchorEl, destName, url) {
  if (!tooltipEl) createTooltip();

  const rect = anchorEl.getBoundingClientRect();
  const top = rect.top - 10;
  const left = rect.left + (rect.width / 2);

  if (url) {
    tooltipEl.innerHTML = `
      <div class="cit-tooltip-content">
        <span class="cit-tooltip-label">Citation Link (${destName})</span>
        <a class="cit-tooltip-url" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
        <div class="cit-tooltip-actions">
          <span class="cit-tooltip-action-btn copy-btn">Copy Link</span>
        </div>
      </div>
    `;

    tooltipEl.querySelector('.copy-btn').addEventListener('click', (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(url);
      const btn = e.target;
      btn.innerText = 'Copied!';
      setTimeout(() => { btn.innerText = 'Copy Link'; }, 2000);
    });
  } else {
    tooltipEl.innerHTML = `
      <div class="cit-tooltip-content">
        <span class="cit-tooltip-label">Citation (${destName})</span>
        <span class="cit-tooltip-no-link">No link found in references</span>
      </div>
    `;
  }

  tooltipEl.className = 'cit-tooltip-visible';

  // Position the tooltip centered above the anchor
  const tooltipRect = tooltipEl.getBoundingClientRect();
  tooltipEl.style.top = `${top - tooltipRect.height}px`;
  tooltipEl.style.left = `${left - (tooltipRect.width / 2)}px`;
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.className = 'cit-tooltip-hidden';
  }
}

// Helper: Fetch PDF as ArrayBuffer, supporting both http/https (via fetch) and file:// (via XMLHttpRequest)
function fetchPdfAsArrayBuffer(url) {
  return new Promise((resolve, reject) => {
    if (url.startsWith('file://')) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
          resolve(new Uint8Array(xhr.response));
        } else {
          reject(new Error(`Local file loading failed with status: ${xhr.status}`));
        }
      };
      xhr.onerror = () => {
        reject(new Error('Local file access failed. Make sure "Allow access to file URLs" is enabled in Chrome settings.'));
      };
      xhr.send();
    } else {
      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
          return res.arrayBuffer();
        })
        .then(buf => resolve(new Uint8Array(buf)))
        .catch(reject);
    }
  });
}

// 1. Get query parameters
const urlParams = new URLSearchParams(window.location.search);
const pdfUrl = urlParams.get('file');

if (pdfUrl) {
  const cacheKey = `pdf_cache_${pdfUrl.split('#')[0]}`;
  
  // Try loading from local storage cache
  chrome.storage.local.get([cacheKey], async (result) => {
    if (result[cacheKey]) {
      extractionResult = result[cacheKey];
      console.log('Citation Finder: Loaded citations from cache.', extractionResult);
      applyOverlaysToAllRenderedPages();
    } else {
      console.log('Citation Finder: Cache miss. Extracting citations locally in viewer tab...');
      try {
        const pdfData = await fetchPdfAsArrayBuffer(pdfUrl);

        // Run local extraction (fully supported in tab context)
        extractionResult = await extractCitationsFromPdf(pdfData, {
          workerSrc: '../../pdf.worker.js' // path relative to viewer.html
        });

        console.log('Citation Finder: Local extraction completed.', extractionResult);

        // Save to cache
        const cacheObj = {};
        cacheObj[cacheKey] = extractionResult;
        chrome.storage.local.set(cacheObj);

        applyOverlaysToAllRenderedPages();
      } catch (err) {
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

  // Clear existing overlays on this page first to prevent duplicates when zooming
  const existingOverlays = pageDiv.querySelectorAll('.cit-link-overlay');
  existingOverlays.forEach(el => el.remove());

  const pageView = window.PDFViewerApplication?.pdfViewer?.getPageView(pageNum - 1);
  if (!pageView) return;
  const viewport = pageView.viewport;

  const pageLinks = extractionResult.inlineLinks.filter(l => l.sourcePage === pageNum);
  pageLinks.forEach(link => {
    // Convert PDF coords to viewport pixels
    const rect = viewport.convertToViewportRectangle(link.sourceRect);
    
    // Expand bounding box coordinates slightly for padding (makes hover/click target much more reliable)
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
    overlay.href = link.targetUrl || '#';
    if (link.targetUrl) {
      overlay.target = '_blank';
      overlay.rel = 'noopener noreferrer';
    }

    overlay.addEventListener('mouseover', () => {
      showTooltip(overlay, link.destName, link.targetUrl);
    });

    overlay.addEventListener('mouseout', () => {
      hideTooltip();
    });

    overlay.addEventListener('click', (e) => {
      if (!link.targetUrl) {
        e.preventDefault();
      }
    });

    pageDiv.appendChild(overlay);
  });
}
