const state = {
  shop: new URLSearchParams(window.location.search).get('shop'),
  after: null,
  settings: null,
};

const elements = {
  shopLabel: document.getElementById('shopLabel'),
  scanButton: document.getElementById('scanButton'),
  refreshButton: document.getElementById('refreshButton'),
  banner: document.getElementById('statusBanner'),
  tableBody: document.getElementById('auditTableBody'),
  metricTotal: document.getElementById('metricTotal'),
  metricOversized: document.getElementById('metricOversized'),
  metricAverage: document.getElementById('metricAverage'),
  metricSavings: document.getElementById('metricSavings'),
  settingsForm: document.getElementById('settingsForm'),
  paginationArea: document.getElementById('paginationArea'),
  navLinks: document.querySelectorAll('.nav-link'),
  panels: {
    dashboard: document.getElementById('dashboardPanel'),
    settings: document.getElementById('settingsPanel'),
  },
};

function showBanner(message, type = 'success') {
  elements.banner.textContent = message;
  elements.banner.className = `status-banner ${type}`;
}

function hideBanner() {
  elements.banner.className = 'status-banner hidden';
  elements.banner.textContent = '';
}

function formatKb(value) {
  if (value == null) return 'Unknown';
  if (value >= 1024) return `${(value / 1024).toFixed(2)} MB`;
  return `${value} KB`;
}

function scoreClass(score) {
  if (score >= 80) return 'score-good';
  if (score >= 55) return 'score-mid';
  return 'score-bad';
}

async function api(path, options = {}) {
  const url = new URL(path, window.location.origin);
  if (state.shop) {
    url.searchParams.set('shop', state.shop);
  }

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }

  return response.json();
}

function renderRows(rows) {
  if (!rows.length) {
    elements.tableBody.innerHTML = '<tr><td colspan="6" class="empty-row">No product images found.</td></tr>';
    return;
  }

  elements.tableBody.innerHTML = rows
    .map((row) => `
      <tr>
        <td><img class="preview-img" src="${row.src}" alt="${row.title}" /></td>
        <td>
          <strong>${row.title}</strong>
          <div class="small-muted">/${row.handle} · ${row.status}</div>
        </td>
        <td>${row.width} × ${row.height}<br><span class="small-muted">${row.megapixels || 0} MP</span></td>
        <td>${formatKb(row.fileSizeKb)}${row.estimatedSavedKb ? `<br><span class="small-muted">Could save ~${formatKb(row.estimatedSavedKb)}</span>` : ''}</td>
        <td><span class="score-pill ${scoreClass(row.score)}">${row.score}</span></td>
        <td>${row.recommendation}</td>
      </tr>
    `)
    .join('');
}

function renderSummary(summary) {
  elements.metricTotal.textContent = summary.totalImages;
  elements.metricOversized.textContent = summary.oversizedImages;
  elements.metricAverage.textContent = formatKb(summary.averageKb);
  elements.metricSavings.textContent = formatKb(summary.estimatedSavingsKb);
}

function renderPagination(pageInfo) {
  elements.paginationArea.innerHTML = '';
  if (!pageInfo) return;

  const label = document.createElement('span');
  label.className = 'small-muted';
  label.textContent = pageInfo.hasNextPage ? 'More products available' : 'Latest page loaded';
  elements.paginationArea.appendChild(label);

  if (pageInfo.hasNextPage) {
    const button = document.createElement('button');
    button.className = 'secondary-btn';
    button.textContent = 'Load next page';
    button.addEventListener('click', () => runScan(pageInfo.endCursor));
    elements.paginationArea.appendChild(button);
  }
}

function fillSettings(settings) {
  elements.settingsForm.image_quality.value = settings.image_quality;
  elements.settingsForm.large_image_threshold_kb.value = settings.large_image_threshold_kb;
  elements.settingsForm.auto_scan.checked = Boolean(settings.auto_scan);
}

async function loadSettings() {
  const settings = await api('/api/settings');
  state.settings = settings;
  fillSettings(settings);
}

async function runScan(after = null) {
  hideBanner();
  elements.scanButton.disabled = true;
  elements.scanButton.textContent = 'Scanning…';

  try {
    const url = new URL('/api/scan', window.location.origin);
    url.searchParams.set('shop', state.shop);
    url.searchParams.set('limit', '30');
    if (after) url.searchParams.set('after', after);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    state.after = data.pageInfo?.endCursor || null;
    renderSummary(data.summary);
    renderRows(data.rows);
    renderPagination(data.pageInfo);
    showBanner('Scan completed successfully.', 'success');
  } catch (error) {
    console.error(error);
    showBanner(`Scan failed. ${error.message}`, 'error');
  } finally {
    elements.scanButton.disabled = false;
    elements.scanButton.textContent = 'Run scan';
  }
}

function setupNavigation() {
  elements.navLinks.forEach((button) => {
    button.addEventListener('click', () => {
      elements.navLinks.forEach((btn) => btn.classList.remove('active'));
      Object.values(elements.panels).forEach((panel) => panel.classList.remove('active'));
      button.classList.add('active');
      elements.panels[button.dataset.panel].classList.add('active');
    });
  });
}

async function bootstrapAppBridge() {
  try {
    const config = await api('/api/config');
    elements.shopLabel.textContent = config.shop;

    if (window.shopify && window.shopify.createApp) {
      window.shopify.createApp({
        apiKey: config.apiKey,
        host: new URLSearchParams(window.location.search).get('host'),
        forceRedirect: true,
      });
    }
  } catch (error) {
    console.error(error);
    showBanner(`Failed to initialize app shell. ${error.message}`, 'error');
  }
}

async function init() {
  if (!state.shop) {
    showBanner('Missing shop parameter in URL.', 'error');
    return;
  }

  setupNavigation();
  await bootstrapAppBridge();
  await loadSettings();

  elements.refreshButton.addEventListener('click', () => runScan());
  elements.scanButton.addEventListener('click', () => runScan());

  elements.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(elements.settingsForm);

    try {
      const payload = {
        image_quality: Number(formData.get('image_quality')),
        large_image_threshold_kb: Number(formData.get('large_image_threshold_kb')),
        auto_scan: formData.get('auto_scan') === 'on',
      };

      const updated = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      state.settings = updated;
      fillSettings(updated);
      showBanner('Settings saved.', 'success');
    } catch (error) {
      console.error(error);
      showBanner(`Unable to save settings. ${error.message}`, 'error');
    }
  });

  if (state.settings?.auto_scan) {
    runScan();
  }
}

init();
