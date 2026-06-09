document.addEventListener('DOMContentLoaded', async () => {
  const badge = document.getElementById('status-badge');
  const docCard = document.getElementById('doc-card');
  const docName = document.getElementById('doc-name');
  const statsArea = document.getElementById('stats-area');
  const statCitations = document.getElementById('stat-citations');
  const statLinks = document.getElementById('stat-links');
  const statRatio = document.getElementById('stat-ratio');
  const footerMessage = document.getElementById('footer-message');

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      showInactive();
      return;
    }

    const tabUrl = tab.url;
    const viewerUrlPrefix = chrome.runtime.getURL('viewer.html');

    if (tabUrl.startsWith(viewerUrlPrefix)) {
      // Current tab is viewing a PDF in our custom viewer
      const parsedUrl = new URL(tabUrl);
      const pdfUrl = parsedUrl.searchParams.get('file');

      if (pdfUrl) {
        const filename = decodeURIComponent(pdfUrl.split('/').pop().split('?')[0]);
        const cacheKey = `pdf_cache_${pdfUrl.split('#')[0]}`;

        // Retrieve stats from storage cache
        chrome.storage.local.get([cacheKey], (result) => {
          const cachedData = result[cacheKey];

          if (cachedData) {
            // Show stats
            badge.innerText = 'Active';
            badge.className = 'status-badge status-active';

            docCard.style.display = 'block';
            docName.innerText = filename;

            statsArea.style.display = 'grid';
            statCitations.innerText = cachedData.citations.length;
            statLinks.innerText = cachedData.inlineLinks.length;

            // Calculate match rate (resolved inline links vs total inline links)
            const totalLinks = cachedData.inlineLinks.length;
            const resolvedLinks = cachedData.inlineLinks.filter(l => l.targetUrl !== null).length;
            const matchRate = totalLinks > 0 ? Math.round((resolvedLinks / totalLinks) * 100) : 0;

            statRatio.innerText = `${matchRate}% (${resolvedLinks}/${totalLinks})`;

            footerMessage.innerText = 'Citation Finder is active. Hover over inline links to view citation target tooltips.';
          } else {
            // Document is loading or parsing
            badge.innerText = 'Loading';
            badge.className = 'status-badge';
            badge.style.background = 'rgba(59, 130, 246, 0.15)';
            badge.style.color = '#3b82f6';
            badge.style.border = '1px solid rgba(59, 130, 246, 0.2)';

            docCard.style.display = 'block';
            docName.innerText = filename;

            footerMessage.innerText = 'Resolving reference citations. Please wait...';
          }
        });
      } else {
        showInactive();
      }
    } else {
      showInactive();
    }
  } catch (err) {
    console.error('Error fetching popup stats:', err);
    showInactive();
  }

  function showInactive() {
    badge.innerText = 'Inactive';
    badge.className = 'status-badge status-inactive';
    docCard.style.display = 'none';
    statsArea.style.display = 'none';
    footerMessage.innerText = 'Open any PDF file link or drag-and-drop a PDF to activate finder.';
  }
});
