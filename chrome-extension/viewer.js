import { extractCitationsFromPdf, loadPdfDocument } from './extractor.js';

let pdfDoc = null;
let extractionResult = null;
let currentZoom = 1.3;
let pageContainers = [];

// DOM Elements
const loader = document.getElementById('loader');
const loaderStatus = document.getElementById('loader-status');
const workspace = document.getElementById('workspace');
const sidebar = document.getElementById('sidebar');
const citCountEl = document.getElementById('cit-count');
const citationsList = document.getElementById('citations-list');
const docTitleEl = document.getElementById('document-title');
const zoomValueEl = document.getElementById('zoom-value');

// Tooltip Element
let tooltipEl = null;

function createTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'citation-tooltip';
  tooltipEl.className = 'cit-tooltip-hidden';
  document.body.appendChild(tooltipEl);
}

function showTooltip(anchorEl, destName, url) {
  if (!tooltipEl) createTooltip();

  const rect = anchorEl.getBoundingClientRect();
  const top = rect.top + window.scrollY - 10;
  const left = rect.left + window.scrollX + (rect.width / 2);

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

// 1. Get query parameters
const urlParams = new URLSearchParams(window.location.search);
const pdfUrl = urlParams.get('file');

if (!pdfUrl) {
  showError('Error: No PDF file specified. Use ?file=<url>');
} else {
  initPdfViewer(pdfUrl);
}

function showError(message) {
  loaderStatus.innerText = message;
  loaderStatus.style.color = '#ef4444';
  const spinner = loader.querySelector('.spinner');
  if (spinner) spinner.style.display = 'none';
}

// 2. Fetch and initialize
async function initPdfViewer(url) {
  try {
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
    docTitleEl.innerText = filename;

    loaderStatus.innerText = 'Downloading PDF file...';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const pdfData = new Uint8Array(arrayBuffer);

    loaderStatus.innerText = 'Parsing PDF document structure...';
    
    // Load document and run citation extractor concurrently
    pdfDoc = await loadPdfDocument(pdfData.slice(), {
      workerSrc: 'pdf.worker.js'
    });

    loaderStatus.innerText = 'Running local citation resolution extraction...';
    extractionResult = await extractCitationsFromPdf(pdfData.slice(), {
      workerSrc: 'pdf.worker.js'
    });

    // Save to storage cache for popup stats
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const cacheKey = `pdf_cache_${url.split('#')[0]}`;
      const cacheObj = {};
      cacheObj[cacheKey] = extractionResult;
      chrome.storage.local.set(cacheObj, () => {
        console.log(`Saved parsed citations to cache from viewer for: ${url}`);
      });
    } else {
      console.log('chrome.storage.local is not available (running outside extension context)');
    }

    loaderStatus.innerText = 'Rendering PDF document...';
    
    // Setup Sidebar
    populateSidebar(extractionResult.citations);

    // Render workspace
    await renderWorkspace();

    // Hide loader
    loader.style.display = 'none';
  } catch (err) {
    console.error('Initialization error:', err);
    showError(`Error opening PDF: ${err.message}`);
  }
}

// Populate Sidebar lists
function populateSidebar(citations) {
  citCountEl.innerText = citations.length;
  citationsList.innerHTML = '';

  if (citations.length === 0) {
    citationsList.innerHTML = `
      <div style="color: var(--text-muted); font-size: 13px; text-align: center; margin-top: 32px;">
        No bibliography references found in this document.
      </div>
    `;
    return;
  }

  citations.forEach((cit, index) => {
    const card = document.createElement('div');
    card.className = 'citation-card';
    
    let urlHtml = '';
    if (cit.url) {
      urlHtml = `<a class="card-url" href="${cit.url}" target="_blank" rel="noopener noreferrer">${cit.url}</a>`;
    } else {
      urlHtml = `<span style="color: var(--text-muted); font-style: italic; font-size: 11px;">No link resolved</span>`;
    }

    card.innerHTML = `
      <div>${cit.text}</div>
      ${urlHtml}
      <div class="citation-card-meta">
        <span>Page ${cit.page}</span>
        <span style="color: var(--accent-color); cursor: pointer;" class="jump-link">Jump to citation</span>
      </div>
    `;

    // Hook jump button
    card.querySelector('.jump-link').addEventListener('click', (e) => {
      e.stopPropagation();
      scrollToCitation(cit);
    });

    citationsList.appendChild(card);
  });
}

// Scroll to page + Y position of reference citation
async function scrollToCitation(cit) {
  const container = document.getElementById(`page-container-${cit.page}`);
  if (!container) return;

  try {
    const page = await pdfDoc.getPage(cit.page);
    const viewport = page.getViewport({ scale: currentZoom });
    
    // PDF coordinates have origin at bottom left. Viewport coordinates have origin at top left.
    const pdfHeight = page.view[3];
    const ratio = viewport.height / pdfHeight;
    const topInPixels = viewport.height - (cit.startY * ratio);

    const targetOffset = container.offsetTop + topInPixels - 120; // offset for top navbar
    workspace.scrollTo({ top: targetOffset, behavior: 'smooth' });
    
    // Flash effect
    container.style.outline = '3px solid var(--accent-color)';
    container.style.transition = 'outline 0.3s ease';
    setTimeout(() => {
      container.style.outline = 'none';
    }, 1500);
  } catch (err) {
    console.error('Jump error:', err);
  }
}

// 3. Render all pages in the workspace
async function renderWorkspace() {
  workspace.innerHTML = '';
  pageContainers = [];

  const numPages = pdfDoc.numPages;
  for (let p = 1; p <= numPages; p++) {
    const pageContainer = await renderPage(p);
    workspace.appendChild(pageContainer);
    pageContainers.push(pageContainer);
  }
}

// Render a single page and set up link overlays
async function renderPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: currentZoom });

  const container = document.createElement('div');
  container.id = `page-container-${pageNum}`;
  container.className = 'page-container';
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  container.appendChild(canvas);

  const canvasContext = canvas.getContext('2d');
  const renderContext = {
    canvasContext,
    viewport,
  };

  await page.render(renderContext).promise;

  // Add transparent clickable overlays for internal citation links
  if (extractionResult && extractionResult.inlineLinks) {
    const pageLinks = extractionResult.inlineLinks.filter(l => l.sourcePage === pageNum);
    
    pageLinks.forEach(link => {
      // link.sourceRect is [x1, y1, x2, y2] in PDF coordinates (from bottom-left)
      // Convert to viewport coordinates (from top-left)
      const rect = viewport.convertToViewportRectangle(link.sourceRect); // [x1, y1, x2, y2]
      
      const x = Math.min(rect[0], rect[2]);
      const y = Math.min(rect[1], rect[3]);
      const w = Math.abs(rect[2] - rect[0]);
      const h = Math.abs(rect[3] - rect[1]);

      const overlay = document.createElement('a');
      overlay.className = 'link-overlay';
      overlay.style.left = `${x}px`;
      overlay.style.top = `${y}px`;
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
      overlay.href = link.targetUrl || '#';
      if (link.targetUrl) {
        overlay.target = '_blank';
        overlay.rel = 'noopener noreferrer';
      }

      // Hover events to trigger glassmorphic tooltips
      overlay.addEventListener('mouseover', (e) => {
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

      container.appendChild(overlay);
    });
  }

  return container;
}

// Zoom controls
document.getElementById('btn-zoom-in').addEventListener('click', async () => {
  if (currentZoom >= 3.0) return;
  currentZoom = parseFloat((currentZoom + 0.2).toFixed(1));
  zoomValueEl.innerText = `${Math.round(currentZoom * 100)}%`;
  loader.style.display = 'flex';
  loaderStatus.innerText = 'Re-rendering pages...';
  await renderWorkspace();
  loader.style.display = 'none';
});

document.getElementById('btn-zoom-out').addEventListener('click', async () => {
  if (currentZoom <= 0.5) return;
  currentZoom = parseFloat((currentZoom - 0.2).toFixed(1));
  zoomValueEl.innerText = `${Math.round(currentZoom * 100)}%`;
  loader.style.display = 'flex';
  loaderStatus.innerText = 'Re-rendering pages...';
  await renderWorkspace();
  loader.style.display = 'none';
});

document.getElementById('btn-zoom-fit').addEventListener('click', async () => {
  // Fit to workspace width minus padding
  const workspaceWidth = workspace.clientWidth - 80;
  if (pdfDoc) {
    const page = await pdfDoc.getPage(1);
    const originalWidth = page.view[2];
    currentZoom = parseFloat((workspaceWidth / originalWidth).toFixed(2));
    zoomValueEl.innerText = `${Math.round(currentZoom * 100)}%`;
    loader.style.display = 'flex';
    loaderStatus.innerText = 'Re-rendering pages...';
    await renderWorkspace();
    loader.style.display = 'none';
  }
});

// Sidebar toggle
document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
  if (sidebar.style.display === 'none') {
    sidebar.style.display = 'flex';
  } else {
    sidebar.style.display = 'none';
  }
});
