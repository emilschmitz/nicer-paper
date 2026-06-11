document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('status-badge');
  const docCard = document.getElementById('doc-card');
  const docName = document.getElementById('doc-name');
  const statsArea = document.getElementById('stats-area');
  const statCitations = document.getElementById('stat-citations');
  const statLinks = document.getElementById('stat-links');
  const statRatio = document.getElementById('stat-ratio');
  const footerMessage = document.getElementById('footer-message');

  // Elements for progress bar
  const progressCard = document.getElementById('progress-card');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressText = document.getElementById('progress-text');

  // Elements for settings
  const whitelistList = document.getElementById('whitelist-list');
  const blacklistList = document.getElementById('blacklist-list');
  const patternInput = document.getElementById('pattern-input');
  const patternType = document.getElementById('pattern-type');
  const btnAddPattern = document.getElementById('btn-add-pattern');
  const btnResetPatterns = document.getElementById('btn-reset-patterns');

  // Tooltip preference checkbox elements
  const prefAuthors = document.getElementById('pref-authors');
  const prefYear = document.getElementById('pref-year');
  const prefTitle = document.getElementById('pref-title');
  const prefVenue = document.getElementById('pref-venue');
  const prefAbstract = document.getElementById('pref-abstract');
  const prefOpen = document.getElementById('pref-open');
  const prefCopy = document.getElementById('pref-copy');

  let activeTabUrl = null;
  let pdfUrl = null;
  let progressInterval = null;

  async function checkStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        showInactive();
        return;
      }

      activeTabUrl = tab.url;
      const viewerUrlPrefix = chrome.runtime.getURL('pdfjs/web/viewer.html');

      if (activeTabUrl.startsWith(viewerUrlPrefix)) {
        const parsedUrl = new URL(activeTabUrl);
        pdfUrl = parsedUrl.searchParams.get('file');

        if (pdfUrl) {
          const filename = decodeURIComponent(pdfUrl.split('/').pop().split('?')[0]);
          const cacheKey = `pdf_cache_${pdfUrl.split('#')[0]}`;

          chrome.storage.local.get([cacheKey], (result) => {
            const cachedData = result[cacheKey];

            if (cachedData) {
              // Parsing finished!
              if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
              }
              progressCard.style.display = 'none';

              badge.innerText = 'Active';
              badge.className = 'status-badge status-active';
              badge.style = ''; // Reset custom loading styles

              docCard.style.display = 'block';
              docName.innerText = filename;

              statsArea.style.display = 'grid';
              statCitations.innerText = cachedData.citations.length;
              statLinks.innerText = cachedData.inlineLinks.length;

              const totalLinks = cachedData.inlineLinks.length;
              const resolvedLinks = cachedData.inlineLinks.filter(l => l.targetUrl !== null).length;
              const matchRate = totalLinks > 0 ? Math.round((resolvedLinks / totalLinks) * 100) : 0;

              statRatio.innerText = `${matchRate}% (${resolvedLinks}/${totalLinks})`;
              footerMessage.innerText = 'Paper Reader is active. Hover over inline links to view citation target tooltips.';
            } else {
              // Still loading/parsing
              badge.innerText = 'Loading';
              badge.className = 'status-badge';
              badge.style.background = 'rgba(59, 130, 246, 0.15)';
              badge.style.color = '#3b82f6';
              badge.style.border = '1px solid rgba(59, 130, 246, 0.2)';

              docCard.style.display = 'block';
              docName.innerText = filename;
              statsArea.style.display = 'none';
              progressCard.style.display = 'block';

              footerMessage.innerText = 'Resolving reference citations. Please wait...';

              // Request progress from background script
              chrome.runtime.sendMessage({ action: 'getExtractionProgress', pdfUrl }, (response) => {
                if (response && response.success && response.progress !== null) {
                  updateProgress(response.progress);
                } else {
                  updateProgress(0);
                }
              });

              // Start polling progress if not already polling
              if (!progressInterval) {
                progressInterval = setInterval(pollProgress, 500);
              }
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
  }

  function updateProgress(progress) {
    progressBarFill.style.width = `${progress}%`;
    progressText.innerText = `${progress}%`;
  }

  function pollProgress() {
    if (!pdfUrl) return;
    chrome.runtime.sendMessage({ action: 'getExtractionProgress', pdfUrl }, (response) => {
      if (response && response.success && response.progress !== null) {
        updateProgress(response.progress);
        if (response.progress === 100) {
          setTimeout(checkStatus, 500);
        }
      }
      // Also check if cache is populated yet (in case save completed and activeParsings entry was deleted)
      const cacheKey = `pdf_cache_${pdfUrl.split('#')[0]}`;
      chrome.storage.local.get([cacheKey], (result) => {
        if (result[cacheKey]) {
          checkStatus();
        }
      });
    });
  }

  function showInactive() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    badge.innerText = 'Inactive';
    badge.className = 'status-badge status-inactive';
    badge.style = '';
    docCard.style.display = 'none';
    progressCard.style.display = 'none';
    statsArea.style.display = 'none';
    footerMessage.innerText = 'Open any PDF file link or drag-and-drop a PDF to activate finder.';
  }

  // Load and render whitelist / blacklist patterns
  function loadPatterns() {
    chrome.storage.local.get(['whitelistPatterns', 'blacklistPatterns'], (result) => {
      const whitelist = result.whitelistPatterns || [];
      const blacklist = result.blacklistPatterns || [];

      renderPatternList(whitelistList, whitelist, 'whitelist');
      renderPatternList(blacklistList, blacklist, 'blacklist');
    });
  }

  function renderPatternList(container, patterns, type) {
    container.innerHTML = '';
    if (patterns.length === 0) {
      container.innerHTML = `<div class="pattern-item" style="color: var(--text-muted); justify-content: center; font-style: italic;">No patterns configured</div>`;
      return;
    }

    patterns.forEach((pattern, index) => {
      const item = document.createElement('div');
      item.className = 'pattern-item';

      const text = document.createElement('span');
      text.className = 'pattern-text';
      text.innerText = pattern;
      text.title = pattern;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-delete';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.addEventListener('click', () => deletePattern(type, index));

      item.appendChild(text);
      item.appendChild(deleteBtn);
      container.appendChild(item);
    });
  }

  function deletePattern(type, index) {
    const key = type === 'whitelist' ? 'whitelistPatterns' : 'blacklistPatterns';
    chrome.storage.local.get([key], (result) => {
      const patterns = result[key] || [];
      patterns.splice(index, 1);
      const update = {};
      update[key] = patterns;
      chrome.storage.local.set(update, loadPatterns);
    });
  }

  btnAddPattern.addEventListener('click', () => {
    const patternValue = patternInput.value.trim();
    if (!patternValue) {
      patternInput.classList.add('input-error');
      return;
    }
    patternInput.classList.remove('input-error');

    // Simple regex validation
    try {
      new RegExp(patternValue);
    } catch (e) {
      patternInput.classList.add('input-error');
      return;
    }

    const type = patternType.value; // 'allow' or 'block'
    const key = type === 'allow' ? 'whitelistPatterns' : 'blacklistPatterns';

    chrome.storage.local.get([key], (result) => {
      const patterns = result[key] || [];
      if (!patterns.includes(patternValue)) {
        patterns.push(patternValue);
        const update = {};
        update[key] = patterns;
        chrome.storage.local.set(update, () => {
          patternInput.value = '';
          loadPatterns();
        });
      }
    });
  });

  patternInput.addEventListener('input', () => {
    patternInput.classList.remove('input-error');
  });

  btnResetPatterns.addEventListener('click', () => {
    chrome.storage.local.set({
      whitelistPatterns: [],
      blacklistPatterns: [],
      tooltipPreferences: {
        showAuthors: true,
        showYear: true,
        showTitle: true,
        showVenue: true,
        showAbstract: true,
        showOpenPaper: true,
        showCopyLink: true
      }
    }, () => {
      loadPatterns();
      loadPreferences();
    });
  });

  const toggleSettings = document.getElementById('toggle-settings');
  const settingsPanel = document.getElementById('settings-panel');

  toggleSettings.addEventListener('click', () => {
    if (settingsPanel.style.display === 'none') {
      settingsPanel.style.display = 'block';
      toggleSettings.innerText = '⚙️ Hide Settings';
    } else {
      settingsPanel.style.display = 'none';
      toggleSettings.innerText = '⚙️ Show Settings';
    }
  });

  function loadPreferences() {
    chrome.storage.local.get(['tooltipPreferences'], (result) => {
      const prefs = result.tooltipPreferences || {
        showAuthors: true,
        showYear: true,
        showTitle: true,
        showVenue: true,
        showAbstract: true,
        showOpenPaper: true,
        showCopyLink: true
      };

      prefAuthors.checked = prefs.showAuthors !== false;
      prefYear.checked = prefs.showYear !== false;
      prefTitle.checked = prefs.showTitle !== false;
      prefVenue.checked = prefs.showVenue !== false;
      prefAbstract.checked = prefs.showAbstract !== false;
      prefOpen.checked = prefs.showOpenPaper !== false;
      prefCopy.checked = prefs.showCopyLink !== false;
    });
  }

  function savePreferences() {
    const prefs = {
      showAuthors: prefAuthors.checked,
      showYear: prefYear.checked,
      showTitle: prefTitle.checked,
      showVenue: prefVenue.checked,
      showAbstract: prefAbstract.checked,
      showOpenPaper: prefOpen.checked,
      showCopyLink: prefCopy.checked
    };
    chrome.storage.local.set({ tooltipPreferences: prefs });
  }

  [prefAuthors, prefYear, prefTitle, prefVenue, prefAbstract, prefOpen, prefCopy].forEach(cb => {
    cb.addEventListener('change', savePreferences);
  });

  // Initialize
  checkStatus();
  loadPatterns();
  loadPreferences();
});
