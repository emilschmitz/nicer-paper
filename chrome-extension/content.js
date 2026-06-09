// content.js - Injected into the PDF viewer page
let tooltipEl = null;
let hoverTimeout = null;

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
}

// Show tooltip at coordinate
function showTooltip(anchorEl, text, url) {
  if (!tooltipEl) createTooltip();
  
  const rect = anchorEl.getBoundingClientRect();
  const top = rect.top + window.scrollY - 10;
  const left = rect.left + window.scrollX + (rect.width / 2);

  // Re-style depending on whether a URL is available
  if (url) {
    tooltipEl.innerHTML = `
      <div class="cit-tooltip-content">
        <span class="cit-tooltip-label">Citation Link</span>
        <a class="cit-tooltip-url" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
        <div class="cit-tooltip-actions">
          <span class="cit-tooltip-action-btn copy-btn">Copy Link</span>
        </div>
      </div>
    `;
    
    // Add copy functionality
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
        <span class="cit-tooltip-label">Citation</span>
        <span class="cit-tooltip-no-link">No link found in text</span>
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

// Listen for mouse hover on link elements inside the PDF viewer
document.addEventListener('mouseover', (e) => {
  const target = e.target;
  if (target && target.tagName === 'A') {
    const href = target.getAttribute('href') || '';
    
    // Check if the link is an internal named destination citation (e.g. #nameddest=cite.Simonyan2015 or #cite.dai2015semi)
    if (href.startsWith('#nameddest=cite.') || href.startsWith('#cite.')) {
      const destKey = href.replace(/^#(nameddest=)?/, '');
      
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        // Request resolved URL from background script
        chrome.runtime.sendMessage(
          { action: 'getLinkForCitation', destKey, pdfUrl: window.location.href },
          (response) => {
            if (response && response.success) {
              showTooltip(target, destKey, response.url);
            }
          }
        );
      }, 350); // Debounce hover to prevent flickering
    }
  }
});

document.addEventListener('mouseout', (e) => {
  const target = e.target;
  if (target && target.tagName === 'A') {
    clearTimeout(hoverTimeout);
    hideTooltip();
  }
});

// Init page
injectStyles();
createTooltip();
console.log('Citation Tooltips Extension initialized.');
