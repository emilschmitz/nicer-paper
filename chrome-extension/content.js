// content.js - Injected into the PDF viewer page
let tooltipEl = null;
let hoverTimeout = null;
let hideTimeout = null;
let currentDestKey = null;
let currentTargetEl = null;
let currentUrl = null;

// CSS Inject helper
function injectStyles() {
  if (document.getElementById('cit-tooltip-styles')) return;
  const link = document.createElement('link');
  link.id = 'cit-tooltip-styles';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('tooltip.css');
  document.head.appendChild(link);
}

// Initialize tooltip element
function createTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'citation-tooltip';
  tooltipEl.className = 'cit-tooltip-hidden';
  document.body.appendChild(tooltipEl);

  // Keep tooltip open when hovering inside it
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
  }, 250); // Small buffer to let mouse enter tooltip
}

// Update tooltip with asynchronously fetched API metadata/abstract
function updateTooltipWithEnrichedData(metadata, abstract) {
  if (!tooltipEl) return;
  
  const authorsEl = tooltipEl.querySelector('.cit-tooltip-authors');
  const yearEl = tooltipEl.querySelector('.cit-tooltip-year');
  const titleEl = tooltipEl.querySelector('.cit-tooltip-title');
  const venueEl = tooltipEl.querySelector('.cit-tooltip-venue');
  const abstractEl = tooltipEl.querySelector('.cit-tooltip-abstract');
  
  if (metadata) {
    if (authorsEl && metadata.authors) {
      authorsEl.innerText = metadata.authors;
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

  // Re-position because height might have changed
  repositionTooltip();
}

function repositionTooltip() {
  if (!tooltipEl || !currentTargetEl) return;
  
  const rect = currentTargetEl.getBoundingClientRect();
  const top = rect.top + window.scrollY - 8;
  const left = rect.left + window.scrollX + (rect.width / 2);

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

  const authors = metadata?.authors || 'Unknown Authors';
  const year = metadata?.year || '';
  const title = metadata?.title || 'Citation Reference';
  const venue = metadata?.venue || '';

  let abstractHtml = '';
  // Only show abstract loading or preview if we have a resolved target URL/DOI to query
  if (url) {
    if (abstract) {
      abstractHtml = `<div class="cit-tooltip-abstract">${abstract}</div>`;
    } else {
      abstractHtml = `<div class="cit-tooltip-abstract cit-loading">Loading abstract...</div>`;
    }
  }

  let footerHtml = '';
  if (url) {
    footerHtml = `
      <div class="cit-tooltip-footer">
        <a class="cit-tooltip-url-btn" href="${url}" target="_blank" rel="noopener noreferrer">Open Paper</a>
        <span class="cit-tooltip-action-btn copy-btn">Copy Link</span>
      </div>
    `;
  } else {
    footerHtml = `
      <div class="cit-tooltip-footer">
        <span class="cit-tooltip-label">Local citation preview</span>
      </div>
    `;
  }

  tooltipEl.innerHTML = `
    <div class="cit-tooltip-content">
      <div class="cit-tooltip-header">
        <span class="cit-tooltip-authors" title="${authors}">${authors}</span>
        <span class="cit-tooltip-year">${year ? `(${year})` : ''}</span>
      </div>
      <div class="cit-tooltip-title">"${title}"</div>
      ${venue ? `<div class="cit-tooltip-venue">${venue}</div>` : ''}
      ${abstractHtml}
      ${footerHtml}
    </div>
  `;

  // Bind copy button event
  if (url) {
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
    const cacheKey = `${window.location.href}::${destKey}`;
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

// Listen for mouse hover on link elements inside the PDF viewer
document.addEventListener('mouseover', (e) => {
  const target = e.target;
  if (target && target.tagName === 'A') {
    const href = target.getAttribute('href') || '';
    
    if (href.startsWith('#nameddest=cite.') || href.startsWith('#cite.')) {
      const destKey = href.replace(/^#(nameddest=)?/, '');
      
      clearTimeout(hoverTimeout);
      clearHideTimeout();
      
      // If we are already hovering over the same citation, do nothing
      if (currentDestKey === destKey) return;

      hoverTimeout = setTimeout(() => {
        const cacheKey = `${window.location.href}::${destKey}`;
        if (citationMemoryCache.has(cacheKey)) {
          const cached = citationMemoryCache.get(cacheKey);
          showTooltip(target, destKey, cached.url, cached.metadata, cached.abstract);
          return;
        }

        chrome.runtime.sendMessage(
          { action: 'getLinkForCitation', destKey, pdfUrl: window.location.href },
          (response) => {
            if (response && response.success) {
              citationMemoryCache.set(cacheKey, {
                url: response.url,
                metadata: response.metadata,
                abstract: response.abstract
              });
              showTooltip(target, destKey, response.url, response.metadata, response.abstract);
            }
          }
        );
      }, 200); // Debounce hover
    }
  }
});

document.addEventListener('mouseout', (e) => {
  const target = e.target;
  if (target && target.tagName === 'A') {
    const href = target.getAttribute('href') || '';
    if (href.startsWith('#nameddest=cite.') || href.startsWith('#cite.')) {
      clearTimeout(hoverTimeout);
      startHideTimeout();
    }
  }
});

// Init page
injectStyles();
createTooltip();
console.log('Citation Tooltips Extension initialized.');
