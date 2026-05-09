function getSiteBasePath() {
  if (typeof window.__SITE_BASE__ === 'string' && window.__SITE_BASE__) {
    return window.__SITE_BASE__;
  }

  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length === 0 || segments[0] === 'items') {
    return '/';
  }

  return `/${segments[0]}/`;
}

const SITE_BASE_PATH = getSiteBasePath();
const ROUTE_PREFIX = `${SITE_BASE_PATH}items/`;
const DEFAULT_WINDOW = '15d';

// Filter cache management
const FILTER_CACHE_KEY = 'mwi_home_filters';

function saveFilters(category, searchQuery) {
  try {
    localStorage.setItem(FILTER_CACHE_KEY, JSON.stringify({ category, searchQuery }));
  } catch (e) {
    console.warn('Failed to save filter cache:', e);
  }
}

function loadFilters() {
  try {
    const cached = localStorage.getItem(FILTER_CACHE_KEY);
    return cached ? JSON.parse(cached) : { category: 'all', searchQuery: '' };
  } catch (e) {
    console.warn('Failed to load filter cache:', e);
    return { category: 'all', searchQuery: '' };
  }
}

// Global catalog cache to prevent redundant parsing
let G_CATALOG_CACHE = null;
const WINDOW_CONFIG = {
  '1d': { label: '1 Day', hours: 24 },
  '7d': { label: '7 Days', hours: 24 * 7 },
  '15d': { label: '15 Days', hours: 24 * 15 },
  '30d': { label: '30 Days', hours: 24 * 30 },
  '60d': { label: '60 Days', hours: 24 * 60 },
  '90d': { label: '90 Days', hours: 24 * 90 },
  '120d': { label: '120 Days', hours: 24 * 120 },
};

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${path} (${response.status})`);
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugToTitle(slug) {
  return slug
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return value.toLocaleString();
}

function formatCompactNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }

  // Uses Intl.NumberFormat for clean 'k', 'm', 'b' abbreviations
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value).toLowerCase();
}

function formatPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }

  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatCurrency(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }

  return value.toLocaleString('en-US');
}

function formatDayLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
}

function formatHourLabel(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });
}

function formatChange(value) {
  return formatPercent(value);
}

function getRoute() {
  const path = window.location.pathname.startsWith(SITE_BASE_PATH)
    ? window.location.pathname.slice(SITE_BASE_PATH.length)
    : window.location.pathname.replace(/^\/+/, '');
  const cleaned = path.replace(/\/+$/, '');

  if (cleaned.startsWith('items/')) {
    return { type: 'item', slug: decodeURIComponent(cleaned.slice('items/'.length)) };
  }
  return { type: 'home' };
}

function getEffectivePrice(price) {
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

function calcWindowLabel(windowKey) {
  return WINDOW_CONFIG[windowKey]?.label || windowKey;
}

function calcTaxedPrice(value, taxMultiplier) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return value * taxMultiplier;
}

function getSpanTickStep(minValue, maxValue) {
  let span = Math.max(0, maxValue - minValue);
  
  // If span is zero (single value or all same), use 10% of the value as reference range
  if (!Number.isFinite(span) || span <= 0) {
    const refValue = Math.abs(minValue) || 1;
    span = refValue * 0.1;
  }
  
  if (!Number.isFinite(span) || span <= 0) {
    return 1;
  }

  const roughStep = span / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(roughStep, 1))));
  const normalized = roughStep / magnitude;

  let multiplier;
  if (normalized <= 2) multiplier = 2;
  else if (normalized <= 5) multiplier = 5;
  else multiplier = 10;

  return Math.max(1, multiplier * magnitude);
}

function buildChart(points, width = 960, height = 360, fixedMinValue = null, fixedMaxValue = null, windowConfig = null, fullSeries = null) {
  const errorReturn = (msg) => ({
    html: `<div class="empty-state">${msg}</div>`,
    pointPositions: [],
    pointData: [],
    padding: { top: 20, right: 48, bottom: 34, left: 96 },
    innerWidth: 864,
  });

  if (!points.length) {
    return errorReturn('No chart data is available for this selection yet.');
  }

  const yValues = points.flatMap((point) => [point.ask, point.bid]).filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (!yValues.length) {
    return errorReturn('No usable ask or bid values are available for this selection yet.');
  }

  const maxValue = fixedMaxValue !== null ? fixedMaxValue : Math.max(...yValues);
  const minValue = fixedMinValue !== null ? fixedMinValue : Math.min(...yValues);
  const tickStep = getSpanTickStep(minValue, maxValue);
  const paddedMin = Math.floor(minValue / tickStep) * tickStep - (tickStep * 2);
  const paddedMax = Math.ceil(maxValue / tickStep) * tickStep + tickStep;
  const span = paddedMax - paddedMin;

  const maxLabelLength = formatNumber(Math.max(Math.abs(paddedMax), Math.abs(paddedMin))).length;
  const padding = { top: 20, right: 48, bottom: 34, left: 60 }; 
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const halfHourMs = 30 * 60 * 1000;
  let latestTimestamp = null;
  let windowStart = null;
  let scaleX;

  if (windowConfig && fullSeries && fullSeries.length > 0) {
    const windowMs = windowConfig.hours * 60 * 60 * 1000; 
    const timestamps = fullSeries
      .map((p) => p.timestamp)
      .filter((ts) => typeof ts === 'number' && ts > 0);
    
    if (timestamps.length > 0) {
      latestTimestamp = Math.max(...timestamps);
      windowStart = latestTimestamp - windowMs; 
      
      scaleX = (point, index) => {
        if (!point || typeof point.timestamp !== 'number') return padding.left;
        const displayTimestamp = windowConfig.hours <= 24
          ? Math.round(point.timestamp / halfHourMs) * halfHourMs
          : point.timestamp;
        const timeOffset = displayTimestamp - windowStart;
        const position = (timeOffset / windowMs) * innerWidth; 
        return padding.left + position;
      };
    } else {
      scaleX = (_, index) => padding.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    }
  } else {
    scaleX = (_, index) => padding.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  }

  const scaleY = (value) => padding.top + (1 - (value - paddedMin) / span) * innerHeight;

  const pointPositions = points.map((point, index) => ({
    index,
    x: typeof scaleX === 'function' && scaleX.length === 2 ? scaleX(point, index) : scaleX(index),
    askY: typeof point.ask === 'number' && point.ask > 0 ? scaleY(point.ask) : null,
    bidY: typeof point.bid === 'number' && point.bid > 0 ? scaleY(point.bid) : null,
  }));

  const validPriceIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (getEffectivePrice(points[i].ask) != null || getEffectivePrice(points[i].bid) != null) {
      validPriceIndices.push(i);
    }
  }

  let firstPriceX = padding.left;
  let lastPriceX = width - padding.right;
  let leftHalfStep = innerWidth * 0.125;
  let rightHalfStep = innerWidth * 0.125;

  if (validPriceIndices.length > 0) {
    const firstIdx = validPriceIndices[0];
    const lastIdx = validPriceIndices[validPriceIndices.length - 1];
    firstPriceX = pointPositions[firstIdx].x;
    lastPriceX = pointPositions[lastIdx].x;

    if (validPriceIndices.length > 1) {
      const secondIdx = validPriceIndices[1];
      const prevIdx = validPriceIndices[validPriceIndices.length - 2];
      leftHalfStep = Math.max(0, (pointPositions[secondIdx].x - firstPriceX) / 2);
      rightHalfStep = Math.max(0, (lastPriceX - pointPositions[prevIdx].x) / 2);
    }
  }

  // Shift all plotted points left so the left extension starts at the chart start.
  const leftShift = Math.max(0, (firstPriceX - leftHalfStep) - padding.left);
  if (leftShift > 0) {
    for (let i = 0; i < pointPositions.length; i++) {
      pointPositions[i].x -= leftShift;
    }
    firstPriceX -= leftShift;
    lastPriceX -= leftShift;
  }

  const chartStartX = firstPriceX - leftHalfStep;
  const chartEndX = lastPriceX + rightHalfStep;

  const toPath = (accessor) => {
    const pathSegments = points.map((point, index) => accessor(point) != null ? `${index === 0 ? 'M' : 'L'} ${pointPositions[index].x.toFixed(1)} ${scaleY(accessor(point)).toFixed(1)}` : '').filter(Boolean);
    return pathSegments.join(' ');
  };

  const toAreaPath = (accessor) => {
    const validIndices = [];
    for (let i = 0; i < points.length; i++) if (accessor(points[i]) != null) validIndices.push(i);
    if (validIndices.length === 0) return '';
    
    let pathStr = toPath(accessor);
    const lastIdx = validIndices[validIndices.length - 1];
    const firstIdx = validIndices[0];
    const bottomY = padding.top + innerHeight;
    
    pathStr += ` L ${pointPositions[lastIdx].x.toFixed(1)} ${bottomY.toFixed(1)}`;
    pathStr += ` L ${pointPositions[firstIdx].x.toFixed(1)} ${bottomY.toFixed(1)} Z`;
    
    return pathStr;
  };

  const grid = [];
  const firstTick = Math.ceil(paddedMin / tickStep) * tickStep;
  const lastTick = Math.floor(paddedMax / tickStep) * tickStep;

  for (let tickValue = firstTick; tickValue <= lastTick; tickValue += tickStep) {
    const y = padding.top + (1 - (tickValue - paddedMin) / span) * innerHeight;
    // Main grid line
    grid.push(`
      <line x1="${firstPriceX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${lastPriceX.toFixed(1)}" y2="${y.toFixed(1)}" class="chart-grid" />
      <text x="${(chartStartX - 12).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-label chart-label-y">${formatCompactNumber(tickValue)}</text>
    `);
    // Extended dashed lines on left and right
    grid.push(`
      <line x1="${chartStartX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${firstPriceX.toFixed(1)}" y2="${y.toFixed(1)}" class="chart-grid-extended" stroke-dasharray="4 4" opacity="0.4" />
      <line x1="${lastPriceX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${chartEndX.toFixed(1)}" y2="${y.toFixed(1)}" class="chart-grid-extended" stroke-dasharray="4 4" opacity="0.4" />
    `);
  }

  const isIntraday = windowConfig && windowConfig.hours <= 24;
  let lastLabelX = -100;
  let lastDisplayedLabel = null;
  
  const xAxis = points.map((point, index) => {
    const pos = pointPositions[index];
    const fullLabel = point.label || point.t || '';
    
    let displayLabel = fullLabel;
    if (fullLabel.includes(',')) {
      displayLabel = isIntraday 
        ? fullLabel.split(',')[1].trim() 
        : fullLabel.split(',')[0].trim();
    }
    
    if (displayLabel === lastDisplayedLabel) return '';
    if (pos.x - lastLabelX < 60) return '';
    
    lastDisplayedLabel = displayLabel;
    lastLabelX = pos.x;
    
    return `<text x="${pos.x.toFixed(1)}" y="${height - 6}" text-anchor="middle" class="chart-label">${escapeHtml(displayLabel)}</text>`;
  }).filter(Boolean).join('');


  // ----------------------------------------------------------------------
  // Volume Bars & Ticks 
  // ----------------------------------------------------------------------
  const volumes = points.map((p) => p?.v || 0).filter((v) => v > 0);
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1;
  const maxVolume = volumes.length > 0 ? Math.max(...volumes) : 1;
  
  const getVolumeTickStep = (max) => {
    if (max <= 0) return 1;
    const roughStep = max / 3; 
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalized = roughStep / magnitude;
    
    let multiplier;
    if (normalized <= 2) multiplier = 2;
    else if (normalized <= 5) multiplier = 5;
    else multiplier = 10;
    
    return multiplier * magnitude;
  };

  const volStep = getVolumeTickStep(maxVolume);
  const maxVolumeForScale = Math.ceil(maxVolume / volStep) * volStep;
  
  const tickHeightPx = innerHeight / (span / tickStep);
  const volumeBarMaxHeight = tickHeightPx * 1.5; 
  const volumeBaseY = height - padding.bottom; 
  
  let theoreticalWidth = 80;
  if (windowConfig && windowConfig.hours > 0) {
    const windowMs = windowConfig.hours * 60 * 60 * 1000;
    let stepMs = 60 * 60 * 1000;
    
    if (windowConfig.hours <= 24) stepMs = 60 * 60 * 1000;
    else if (windowConfig.hours <= 168) stepMs = 6 * 60 * 60 * 1000;
    else if (windowConfig.hours <= 360) stepMs = 12 * 60 * 60 * 1000;
    else if (windowConfig.hours <= 720) stepMs = 24 * 60 * 60 * 1000;
    else if (windowConfig.hours <= 1440) stepMs = 48 * 60 * 60 * 1000;
    else if (windowConfig.hours <= 2160) stepMs = 72 * 60 * 60 * 1000;
    else stepMs = 96 * 60 * 60 * 1000;
    
    theoreticalWidth = (stepMs / windowMs) * innerWidth * 0.8;
  }

  const minMarkerSpacing = pointPositions.length > 1
    ? pointPositions.slice(1).reduce((smallest, point, index) => {
      const gap = point.x - pointPositions[index].x;
      return Number.isFinite(gap) && gap > 0 ? Math.min(smallest, gap) : smallest;
    }, innerWidth) 
    : innerWidth;
    
  const volumeBarWidth = Math.max(2, Math.min(theoreticalWidth, minMarkerSpacing * 0.8, 80));
  const volumeTextX = width - padding.right + (volumeBarWidth / 2) + 4;

  const volumeBars = pointPositions.map((point, index) => {
    const volume = points[index]?.v || 0;
    if (volume === 0) return '';
    
    const barHeight = (volume / maxVolumeForScale) * volumeBarMaxHeight;
    const barY = volumeBaseY - barHeight;
    const barX = point.x - volumeBarWidth / 2;
    
    const isAboveAverage = volume >= avgVolume;
    const fillColor = isAboveAverage ? '#2ecc71' : '#95e1d3';
    const opacity = isAboveAverage ? '0.8' : '0.5';
    
    return `<rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${volumeBarWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${fillColor}" opacity="${opacity}" rx="1" ry="1" />`;
  }).join('');

  // ----------------------------------------------------------------------
  // Volume Trendline (5-Period Simple Moving Average)
  // ----------------------------------------------------------------------
  const smaPeriod = 5;
  const volumeTrend = points.map((pt, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - smaPeriod + 1); j <= i; j++) {
       sum += points[j]?.v || 0;
       count++;
    }
    return count > 0 ? sum / count : 0;
  });

  const scaleVolumeY = (vol) => volumeBaseY - (vol / maxVolumeForScale) * volumeBarMaxHeight;
  const volumeTrendPathStr = points.map((_, i) => `${i === 0 ? 'M' : 'L'} ${pointPositions[i].x.toFixed(1)} ${scaleVolumeY(volumeTrend[i]).toFixed(1)}`).join(' ');

  const volumeTrendSvg = volumeTrend.some(v => v > 0) 
    ? `<path d="${volumeTrendPathStr}" fill="none" stroke="#f39c12" stroke-width="1.5" opacity="0.9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 4" />` 
    : '';

  const volumeAxisLabels = [];
  for (let tickVal = volStep; tickVal <= maxVolumeForScale; tickVal += volStep) {
      const yPos = volumeBaseY - (volumeBarMaxHeight * (tickVal / maxVolumeForScale));
      volumeAxisLabels.push(`
          <line x1="${padding.left}" y1="${yPos.toFixed(1)}" x2="${width - padding.right}" y2="${yPos.toFixed(1)}" class="chart-grid" stroke-dasharray="4 4" opacity="0.6" />
          <text x="${volumeTextX.toFixed(1)}" y="${yPos.toFixed(1)}" text-anchor="start" class="chart-label chart-label-y chart-label-volume" alignment-baseline="middle" dominant-baseline="middle" font-size="10px">${formatCompactNumber(tickVal)}</text>
      `);
  }

  const volTitleY = volumeBaseY - volumeBarMaxHeight - 14;
  const volumeAxis = pointPositions.length > 0 ? `
    <text x="${volumeTextX.toFixed(1)}" y="${volTitleY.toFixed(1)}" text-anchor="start" class="chart-label chart-label-y chart-label-volume" font-weight="bold">Vol</text>
    ${volumeAxisLabels.join('')}
  ` : '';

  const toExtensionPaths = (accessor) => {
    const validIndices = [];
    for (let i = 0; i < points.length; i++) if (accessor(points[i]) != null) validIndices.push(i);
    if (validIndices.length === 0) return { left: '', right: '' };
    
    const firstIdx = validIndices[0];
    const lastIdx = validIndices[validIndices.length - 1];
    const firstX = pointPositions[firstIdx].x;
    const firstY = scaleY(accessor(points[firstIdx]));
    const lastX = pointPositions[lastIdx].x;
    const lastY = scaleY(accessor(points[lastIdx]));
    
    // Calculate extension distances as half the distance to next/prev point
    let leftExtDist, rightExtDist;
    if (firstIdx < points.length - 1) {
      const nextX = pointPositions[firstIdx + 1].x;
      leftExtDist = (nextX - firstX) / 2;
    } else {
      leftExtDist = (innerWidth / 2) * 0.25;
    }
    
    if (lastIdx > 0) {
      const prevX = pointPositions[lastIdx - 1].x;
      rightExtDist = (lastX - prevX) / 2;
    } else {
      rightExtDist = (innerWidth / 2) * 0.25;
    }
    
    const leftExtX = firstX - leftExtDist;
    const rightExtX = lastX + rightExtDist;
    
    // Simple horizontal lines
    const leftPath = `M ${leftExtX.toFixed(1)} ${firstY.toFixed(1)} L ${firstX.toFixed(1)} ${firstY.toFixed(1)}`;
    const rightPath = `M ${lastX.toFixed(1)} ${lastY.toFixed(1)} L ${rightExtX.toFixed(1)} ${lastY.toFixed(1)}`;
    
    return { left: leftPath, right: rightPath };
  };

  const askExtensions = toExtensionPaths((point) => getEffectivePrice(point.ask));
  const bidExtensions = toExtensionPaths((point) => getEffectivePrice(point.bid));

  const markers = pointPositions.map((point) => {
    const askCircle = point?.askY != null ? `<circle cx="${point.x.toFixed(1)}" cy="${point.askY.toFixed(1)}" r="2.8" class="chart-point chart-point-ask" />` : '';
    const bidCircle = point?.bidY != null ? `<circle cx="${point.x.toFixed(1)}" cy="${point.bidY.toFixed(1)}" r="2.8" class="chart-point chart-point-bid" />` : '';
    return `${askCircle}${bidCircle}`;
  }).join('');

  return {
    html: `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Item price chart">
        <defs>
          <linearGradient id="ask-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#00d9ff;stop-opacity:0.15" />
            <stop offset="100%" style="stop-color:#00d9ff;stop-opacity:0" />
          </linearGradient>
          <linearGradient id="bid-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#c77dff;stop-opacity:0.15" />
            <stop offset="100%" style="stop-color:#c77dff;stop-opacity:0" />
          </linearGradient>
        </defs>
        ${grid.join('')}
        <path d="${toAreaPath((point) => getEffectivePrice(point.ask))}" class="chart-area chart-area-ask" fill="url(#ask-fill)" />
        <path d="${toAreaPath((point) => getEffectivePrice(point.bid))}" class="chart-area chart-area-bid" fill="url(#bid-fill)" />
        <path d="${toPath((point) => getEffectivePrice(point.ask))}" class="chart-line chart-line-ask" />
        <path d="${toPath((point) => getEffectivePrice(point.bid))}" class="chart-line chart-line-bid" />
        ${askExtensions.left ? `<path d="${askExtensions.left}" class="chart-line chart-line-ask" stroke-dasharray="3 3" stroke-width="2" opacity="0.3" fill="none" />` : ''}
        ${askExtensions.right ? `<path d="${askExtensions.right}" class="chart-line chart-line-ask" stroke-dasharray="3 3" stroke-width="2" opacity="0.3" fill="none" />` : ''}
        ${bidExtensions.left ? `<path d="${bidExtensions.left}" class="chart-line chart-line-bid" stroke-dasharray="3 3" stroke-width="2" opacity="0.3" fill="none" />` : ''}
        ${bidExtensions.right ? `<path d="${bidExtensions.right}" class="chart-line chart-line-bid" stroke-dasharray="3 3" stroke-width="2" opacity="0.3" fill="none" />` : ''}
        ${volumeBars}
        ${volumeTrendSvg}
        ${volumeAxis}
        ${markers}
        ${xAxis}
      </svg>
      <div id="chart-hover" class="chart-hover is-hidden" aria-live="polite"></div>
      <div id="chart-guide" class="chart-guide is-hidden"></div>
    </div>
  `,
    pointPositions,
    pointData: points,
    padding,
    innerWidth,
  };
}

function renderShell(root, title, content, subtitle = '', iconHtml = '', logoHtml = '') {
  root.innerHTML = `
    <header class="hero">
      <p class="kicker">Milky Way Idle</p>
      <div class="hero-title">
        ${iconHtml}
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p class="status">${escapeHtml(subtitle)}</p>
        </div>
      </div>
      ${logoHtml ? `<div class="hero-logo">${logoHtml}</div>` : ''}
    </header>
    ${content}
  `;
}

function itemLink(slug) {
  return `${ROUTE_PREFIX}${encodeURIComponent(slug)}`;
}

function assetPath(relativePath) {
  return `${SITE_BASE_PATH}${relativePath.replace(/^\/+/, '')}`;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (window.location.protocol === 'file:') {
    return;
  }

  try {
    await navigator.serviceWorker.register(`${SITE_BASE_PATH}sw.js`, { scope: SITE_BASE_PATH });
  } catch (error) {
    console.warn('Service worker registration failed:', error);
  }
}

function resolveIconAssetPath(iconFiles, slug, extension) {
  const slugLower = slug.toLowerCase();
  const fileName = iconFiles?.[slugLower]?.[extension] || `${slugLower}.${extension}`;
  return assetPath(`assets/item_icons/${encodeURIComponent(fileName)}`);
}

async function loadCatalog() {
  // Return cached catalog if it exists
  if (G_CATALOG_CACHE) {
    return G_CATALOG_CACHE;
  }

  try {
    const catalog = await fetchJson(assetPath('data/public/index.json'));
    if (Array.isArray(catalog.items)) {
      // Load icon mappings separately from item-icons.json
      try {
        const iconData = await fetchJson(assetPath('data/public/item-icons.json'));
        catalog.iconFiles = iconData.iconFiles || {};
      } catch (error) {
        console.warn('Failed to load icon mappings:', error);
        catalog.iconFiles = {};
      }
      // Cache the catalog for future use
      G_CATALOG_CACHE = catalog;
      return catalog;
    }
  } catch (error) {
    // Fallback handled below.
  }

  G_CATALOG_CACHE = { items: [], iconFiles: {} };
  return G_CATALOG_CACHE;
}

function sortItemsByRefineAndSuffix(items) {
  return [...items].sort((a, b) => {
    const nameA = (a.name || slugToTitle(a.slug)).trim();
    const nameB = (b.name || slugToTitle(b.slug)).trim();

    const lowerA = nameA.toLowerCase();
    const lowerB = nameB.toLowerCase();

    const isRefinedA = lowerA.endsWith(' refined');
    const isRefinedB = lowerB.endsWith(' refined');

    // base name without the trailing "Refined"
    const baseA = isRefinedA ? nameA.slice(0, -' Refined'.length).trim() : nameA;
    const baseB = isRefinedB ? nameB.slice(0, -' Refined'.length).trim() : nameB;

    // suffix is the last word of the base name
    const suffixA = baseA.split(/\s+/).slice(-1)[0].toLowerCase();
    const suffixB = baseB.split(/\s+/).slice(-1)[0].toLowerCase();

    // primary: suffix
    const cmpSuffix = suffixA.localeCompare(suffixB);
    if (cmpSuffix !== 0) return cmpSuffix;

    // If one base equals the suffix exactly (single-word item), prefer it first
    const baseALower = baseA.toLowerCase();
    const baseBLower = baseB.toLowerCase();
    const baseAIsExact = baseALower === suffixA;
    const baseBIsExact = baseBLower === suffixB;
    if (baseAIsExact !== baseBIsExact) return baseAIsExact ? -1 : 1;

    // secondary: base name alphabetical
    const cmpBase = baseA.localeCompare(baseB);
    if (cmpBase !== 0) return cmpBase;

    // tertiary: refined status (non-refined first)
    if (isRefinedA !== isRefinedB) return isRefinedA ? 1 : -1;

    // fallback: full name
    return nameA.localeCompare(nameB);
  });

}

async function renderHome(root) {
  const catalog = await loadCatalog();
  const items = catalog.items || [];

  const ITEMS_PER_PAGE = 48;

  // Load category files and build slug -> category index map
  async function loadCategories() {
    const files = [
      '01_resources.txt',
      '02_consumables.txt',
      '03_books.txt',
      '04_labyrinth.txt',
      '05_keys.txt',
      '06_equipment.txt',
      '07_accessories.txt',
      '08_tools.txt',
    ];
    const categories = [];
    const slugToCategory = {};

    for (let i = 0; i < files.length; i++) {
      const fname = files[i];
      try {
        const res = await fetch(assetPath(`assets/item_categories/${fname}`));
        if (!res.ok) {
          const label = fname.replace(/^\d+_/, '').replace(/\.txt$/, '').replace(/_/g, ' ');
          categories.push({ id: i, label: titleCase(label) });
          continue;
        }
        const text = await res.text();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const label = fname.replace(/^\d+_/, '').replace(/\.txt$/, '').replace(/_/g, ' ');
        const slugs = lines.map(l => l.toLowerCase());
        categories.push({ id: i, label: titleCase(label), slugs });
        for (const slug of slugs) {
          if (slug) slugToCategory[slug] = i;
        }
      } catch (err) {
        const label = fname.replace(/^\d+_/, '').replace(/\.txt$/, '').replace(/_/g, ' ');
        categories.push({ id: i, label: titleCase(label), slugs: [] });
      }
    }

    return { categories, slugToCategory };
  }

  function titleCase(str) {
    return str.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  }

  const renderItemCards = (itemsToRender) => {
    return itemsToRender
      .map((item) => {
        const iconSvg = resolveIconAssetPath(catalog.iconFiles, item.slug, 'svg');
        const iconPng = resolveIconAssetPath(catalog.iconFiles, item.slug, 'png');
          const displayName = (item.name || slugToTitle(item.slug)).replace(/\s+Refined$/, ' (R)');
        return `
      <a class="item-card" href="${itemLink(item.slug)}" loading="lazy">
        <img class="item-icon" src="${iconSvg}" alt="${escapeHtml(item.name || slugToTitle(item.slug))}" onerror="if(!this._tried){this._tried=true;this.src='${iconPng}'}else{this.style.display='none'}" />
        <span class="item-card-title">${escapeHtml(displayName)}</span>
      </a>
    `;
      })
      .join('');
  };

  // Load categories and sort items by category order
  const { categories, slugToCategory } = await loadCategories();

  // Build sortedItems by concatenating categories in file order. Within each category
  // preserve the file order and ensure refined variants appear directly after their base.
  const itemsBySlug = Object.fromEntries(items.map(it => [it.slug.toLowerCase(), it]));
  const added = new Set();
  const sortedItemsArr = [];

  for (const cat of categories) {
    const slugs = Array.isArray(cat.slugs) ? cat.slugs : [];
    for (const slug of slugs) {
      const base = slug.endsWith('_refined') ? slug.slice(0, -'_refined'.length) : slug;

      // Add base if exists
      if (itemsBySlug[base] && !added.has(base)) {
        sortedItemsArr.push(itemsBySlug[base]);
        added.add(base);
      }

      // If category file listed a specific variant (e.g., refined) that isn't the base, add it
      if (itemsBySlug[slug] && !added.has(slug) && slug !== base) {
        sortedItemsArr.push(itemsBySlug[slug]);
        added.add(slug);
      }

      // Add refined variant immediately after base if present
      const refinedSlug = `${base}_refined`;
      if (itemsBySlug[refinedSlug] && !added.has(refinedSlug)) {
        sortedItemsArr.push(itemsBySlug[refinedSlug]);
        added.add(refinedSlug);
      }
    }
  }

  // Append any items not mentioned in category files (keep original catalog order)
  for (const it of items) {
    const slug = it.slug.toLowerCase();
    if (!added.has(slug)) {
      sortedItemsArr.push(it);
      added.add(slug);
    }
  }

  const sortedItems = sortedItemsArr;
  let filteredItems = [...sortedItems];
  const filtersHtml = ['<button class="filter-pill active" data-index="all">All</button>', ...categories.map(c => `<button class="filter-pill" data-index="${c.id}">${escapeHtml(c.label)}</button>` )].join('');

  const renderFilteredItems = () => {
    list.innerHTML = filteredItems.length
      ? renderItemCards(filteredItems)
      : '<div class="empty-state">No items matched that search.</div>';
  };

  const logoHtml = `<img src="${assetPath('assets/logo.svg')}" alt="Logo" class="hero-logo-img" onerror="this.style.display='none'" />`;

  renderShell(
    root,
    'Market Observatory',
    `
      <section class="card">
        <div class="section-header">
          <h2>Pick an item</h2>
          <p>Search or browse to open a dedicated price page.</p>
        </div>
        <input id="item-search" class="search" type="search" placeholder="Search items..." autocomplete="off" />
          <div id="category-filters" class="category-filters">${filtersHtml}</div>
        </div>
        <div id="item-list" class="item-grid"></div>
      </section>
    `,
    'Browse the market history of any item in the game',
    '',
    logoHtml
  );

  const search = document.getElementById('item-search');
  const list = document.getElementById('item-list');
  
  if (!search || !list) {
    return;
  }

  // Load cached filters
  const cachedFilters = loadFilters();
  let selectedCategory = cachedFilters.category;
  search.value = cachedFilters.searchQuery;

  const filtersContainer = document.getElementById('category-filters');
  const gridControls = document.getElementById('grid-size-controls');
  const gridButtons = gridControls ? Array.from(gridControls.querySelectorAll('.grid-size-button')) : [];
  let currentCols = 8;
  // apply initial cols
  list.style.setProperty('--cols', String(currentCols));
  if (gridButtons.length) {
    gridButtons.forEach((b) => {
      b.addEventListener('click', () => {
        const cols = Number(b.dataset.cols) || 8;
        currentCols = cols;
        list.style.setProperty('--cols', String(cols));
        gridButtons.forEach(g => g.classList.toggle('active', g === b));
      });
    });
  }
  if (filtersContainer) {
    filtersContainer.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const idx = btn.dataset.index;
      const newCategory = idx === 'all' ? 'all' : Number(idx);
      
      // If clicking the already selected button, toggle to 'all'
      if (selectedCategory === newCategory && selectedCategory !== 'all') {
        selectedCategory = 'all';
      } else if (selectedCategory === 'all' && newCategory === 'all') {
        // Already on 'all', clicking it again does nothing
        return;
      } else {
        selectedCategory = newCategory;
      }
      
      Array.from(filtersContainer.querySelectorAll('button')).forEach((b) => b.classList.toggle('active', b.dataset.index === String(selectedCategory)));

      const query = search.value.trim().toLowerCase();
      filteredItems = sortedItems.filter((item) => {
        if (selectedCategory !== 'all') {
          const catIdx = typeof slugToCategory[item.slug] === 'number' ? slugToCategory[item.slug] : null;
          if (catIdx !== selectedCategory) return false;
        }
        const name = (item.name || slugToTitle(item.slug)).toLowerCase();
        return !query || name.includes(query) || item.slug.toLowerCase().includes(query);
      });

      saveFilters(selectedCategory, query);
      renderFilteredItems();
    });
  }

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    filteredItems = sortedItems.filter((item) => {
      if (selectedCategory !== 'all') {
        const catIdx = typeof slugToCategory[item.slug] === 'number' ? slugToCategory[item.slug] : null;
        if (catIdx !== selectedCategory) return false;
      }
      const name = (item.name || slugToTitle(item.slug)).toLowerCase();
      return !query || name.includes(query) || item.slug.toLowerCase().includes(query);
    });

    saveFilters(selectedCategory, query);
    renderFilteredItems();
  });

  // Apply cached filters to button states and render
  if (filtersContainer && selectedCategory !== 'all') {
    const targetBtn = filtersContainer.querySelector(`button[data-index="${selectedCategory}"]`);
    if (targetBtn) {
      Array.from(filtersContainer.querySelectorAll('button')).forEach((b) => b.classList.toggle('active', b === targetBtn));
    }
  }

  // Filter items based on cached state
  filteredItems = sortedItems.filter((item) => {
    if (selectedCategory !== 'all') {
      const catIdx = typeof slugToCategory[item.slug] === 'number' ? slugToCategory[item.slug] : null;
      if (catIdx !== selectedCategory) return false;
    }
    const query = search.value.trim().toLowerCase();
    const name = (item.name || slugToTitle(item.slug)).toLowerCase();
    return !query || name.includes(query) || item.slug.toLowerCase().includes(query);
  });

  renderFilteredItems();

}

function windowPoints(points, windowKey) {
  if (!points.length) {
    return [];
  }

  const config = WINDOW_CONFIG[windowKey];
  if (!config) {
    return points;
  }
  const timestamps = points
    .map((point) => point.timestamp)
    .filter((timestamp) => typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0);

  if (!timestamps.length) {
    return points.slice(-config.hours);
  }

  const latestTimestamp = Math.max(...timestamps);
  const windowStart = latestTimestamp - (config.hours * 60 * 60 * 1000);
  return points.filter((point) => typeof point.timestamp === 'number' && point.timestamp >= windowStart);
}

async function renderItem(root, slug) {
  const catalog = await loadCatalog();
  const itemMeta = (catalog.items || []).find((item) => item.slug === slug);
  const itemName = itemMeta?.name || slugToTitle(slug);

  let itemData = null;
  try {
    itemData = await fetchJson(assetPath(`data/public/items/${encodeURIComponent(slug)}.json`));
  } catch (error) {
    itemData = null;
  }

  const levels = itemData?.data || {};
  const levelKeys = itemData?.levels || ['0'];
  let selectedLevel = levelKeys.includes('0') ? '0' : levelKeys[0];
  let selectedWindow = DEFAULT_WINDOW;

  const renderLevelButtons = () => levelKeys
    .map((level) => `<button class="pill ${level === selectedLevel ? 'active' : ''}" data-level="${escapeHtml(level)}">+${escapeHtml(level)}</button>`)
    .join('');

  const renderWindowButtons = () => Object.keys(WINDOW_CONFIG)
    .map((key) => `<button class="pill ${key === selectedWindow ? 'active' : ''}" data-window="${escapeHtml(key)}">${escapeHtml(WINDOW_CONFIG[key].label)}</button>`)
    .join('');

  const usesDailySeries = (windowKey) => (WINDOW_CONFIG[windowKey]?.hours || 0) > (24 * 30);

  const displayBucketMsForWindow = (windowKey) => {
    const hourMs = 60 * 60 * 1000;
    if (windowKey === '1d') return 1 * hourMs; 
    if (windowKey === '7d') return 6 * hourMs;
    if (windowKey === '15d') return 12 * hourMs;
    if (windowKey === '30d') return 24 * hourMs;
    if (windowKey === '60d') return 48 * hourMs;
    if (windowKey === '90d') return 72 * hourMs;
    if (windowKey === '120d') return 96 * hourMs;
    return 24 * hourMs;
  };

  const aggregateDisplaySeries = (series, windowKey) => {
    const bucketMs = displayBucketMsForWindow(windowKey);
    if (!bucketMs) return series.map((point) => ({ ...point }));

    const grouped = [];
    let currentBucket = null;

    for (const point of series) {
      if (!point || typeof point.timestamp !== 'number') continue;
      const bucketStart = Math.floor(point.timestamp / bucketMs) * bucketMs;
      if (!currentBucket || currentBucket.bucketStart !== bucketStart) {
        if (currentBucket) grouped.push(currentBucket);
        currentBucket = { bucketStart, points: [point] };
      } else {
        currentBucket.points.push(point);
      }
    }
    if (currentBucket) grouped.push(currentBucket);

    return grouped.map(({ bucketStart, points: bucketPoints }) => {
      const representative = bucketPoints[bucketPoints.length - 1];
      const lastAskPoint = [...bucketPoints].reverse().find((point) => typeof point.ask === 'number' && Number.isFinite(point.ask) && point.ask > 0) || null;
      const lastBidPoint = [...bucketPoints].reverse().find((point) => typeof point.bid === 'number' && Number.isFinite(point.bid) && point.bid > 0) || null;
      const timestamp = bucketStart;
      const volume = bucketPoints.reduce((sum, point) => sum + (typeof point.v === 'number' && point.v > 0 ? point.v : 0), 0);
      const ask = lastAskPoint ? lastAskPoint.ask : null;
      const bid = lastBidPoint ? lastBidPoint.bid : null;
      const spread = ask != null && bid != null ? ask - bid : null;
      const spreadPct = spread != null && bid > 0 ? spread / bid : null;
      const startDate = new Date(bucketStart);
      const endDate = new Date(bucketStart + bucketMs - 1);
      const label = bucketMs > 24 * 60 * 60 * 1000
        ? `${formatDayLabel(startDate.toISOString().split('T')[0])} - ${formatDayLabel(endDate.toISOString().split('T')[0])}`
        : (bucketMs >= 24 * 60 * 60 * 1000
            ? formatDayLabel(startDate.toISOString().split('T')[0])
            : formatHourLabel(new Date(timestamp).toISOString()));

      return { ...representative, t: timestamp, timestamp, label, ask, bid, a: ask, b: bid, v: volume, sp: spread, spPct: spreadPct };
    });
  };

  const currentSeries = () => {
    const levelData = levels[selectedLevel] || {};
    return usesDailySeries(selectedWindow) ? (levelData.daily || []) : (levelData.hourly || []);
  };

  const currentPoints = () => {
    const series = currentSeries();
    return aggregateDisplaySeries(windowPoints(series, selectedWindow), selectedWindow);
  };

  const getCoverageInfo = () => {
    const requiredHours = WINDOW_CONFIG[selectedWindow]?.hours || 0;
    const sourceSeries = currentSeries();
    const timestamps = sourceSeries
      .map((point) => point?.timestamp)
      .filter((ts) => typeof ts === 'number' && Number.isFinite(ts) && ts > 0)
      .sort((left, right) => left - right);

    if (!requiredHours || !timestamps.length) {
      return {
        isInsufficient: false,
        availableHours: 0,
        requiredHours,
      };
    }

    let stepMs = 0;
    for (let i = 1; i < timestamps.length; i++) {
      const diff = timestamps[i] - timestamps[i - 1];
      if (diff > 0) {
        stepMs = stepMs === 0 ? diff : Math.min(stepMs, diff);
      }
    }

    // If only one point exists, treat one sampling interval as available width.
    if (stepMs <= 0) {
      stepMs = usesDailySeries(selectedWindow) ? (24 * 60 * 60 * 1000) : (60 * 60 * 1000);
    }

    const earliestTs = timestamps[0];
    const latestTs = timestamps[timestamps.length - 1];
    const availableMs = Math.max(0, (latestTs - earliestTs) + stepMs);
    const requiredMs = requiredHours * 60 * 60 * 1000;

    return {
      isInsufficient: availableMs < requiredMs,
      availableHours: availableMs / (60 * 60 * 1000),
      requiredHours,
    };
  };

  const getGlobalRange = () => {
    const allPoints = currentPoints();
    const allYValues = allPoints.flatMap((point) => [point.ask, point.bid]).filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return allYValues.length ? { min: Math.min(...allYValues), max: Math.max(...allYValues) } : { min: null, max: null };
  };

  const renderChartInteractive = () => {
    const points = currentPoints();
    const globalRange = getGlobalRange();
    const chart = document.getElementById('price-chart');
    
    if (!chart) return;
    
    const windowConfig = WINDOW_CONFIG[selectedWindow];
    const chartData = buildChart(points, 960, 400, globalRange.min, globalRange.max, windowConfig, points);
    chart.innerHTML = chartData.html;
    
    const cachedPosData = chartData.pointPositions || [];
    const cachedDataPoints = chartData.pointData || [];

    const chartHover = document.getElementById('chart-hover');
    const chartGuide = document.getElementById('chart-guide');
    const chartWrap = document.querySelector('.chart-wrap');
    
    if (chartHover && chartGuide && chartWrap && points.length) {
      const svg = chartWrap.querySelector('svg');
      const svgBounds = svg.getBoundingClientRect();
      const svgScaleX = svgBounds.width / 960;

      const hideHover = () => {
        chartHover.classList.add('is-hidden');
        chartGuide.classList.add('is-hidden');
      };

      const showHoverForClientX = (clientX) => {
        const hoverWidth = 240;
        const hoverGap = 16;
        const hoverMargin = 12;
        const relativeX = (clientX - svgBounds.left) / svgScaleX;
        
        let closestIndex = 0;
        let closestDistance = Infinity;
        
        cachedPosData.forEach((p, i) => {
          const d = Math.abs(p.x - relativeX);
          if (d < closestDistance) { closestDistance = d; closestIndex = i; }
        });
        
        const point = cachedDataPoints[closestIndex];
        if (!point) { hideHover(); return; }

        const x = cachedPosData[closestIndex].x * svgScaleX;
        chartGuide.classList.remove('is-hidden');
        chartGuide.style.left = `${x - 1}px`;

        chartHover.classList.remove('is-hidden');
        const spaceRight = svgBounds.width - x;
        const hoverLeft = (spaceRight < hoverWidth + hoverGap + hoverMargin) ? Math.max(hoverMargin, x - hoverWidth - hoverGap) : Math.min(x + hoverGap, svgBounds.width - hoverWidth - hoverMargin);

        chartHover.style.left = `${hoverLeft}px`;
        chartHover.style.top = `20px`;
        chartHover.innerHTML = `
          <div class="chart-hover-date">${escapeHtml(point.label)}</div>
          <div class="chart-hover-row"><span>Ask</span><strong>${formatCurrency(point.a)}</strong></div>
          <div class="chart-hover-row"><span>Bid</span><strong>${formatCurrency(point.b)}</strong></div>
          <div class="chart-hover-row"><span>Spread</span><strong>${formatCurrency(point.sp)}</strong></div>
          <div class="chart-hover-row"><span>Spread %</span><strong>${formatPercent(point.spPct)}</strong></div>
          <div class="chart-hover-row"><span>Volume</span><strong>${formatNumber(point.v)}</strong></div>
        `;
      };

      chartWrap.onmouseleave = hideHover;
      chartWrap.onmousemove = (event) => showHoverForClientX(event.clientX);
    }
  };

  const updateView = () => {
    const points = currentPoints();
    const stats = document.getElementById('item-stats');
    const latest = points[points.length - 1];
    const latestHourly = ((levels[selectedLevel] || {}).hourly || []).at(-1) || null;
    const latestDaily = ((levels[selectedLevel] || {}).daily || []).at(-1) || null;

    if (stats) {
      stats.innerHTML = latest ? `
        <div><span class="stat-label">Ask</span><strong>${formatNumber(latest.a)}</strong></div>
        <div><span class="stat-label">Bid</span><strong>${formatNumber(latest.b)}</strong></div>
        <div><span class="stat-label">Spread</span><strong>${formatNumber(latest.sp)}</strong></div>
        <div><span class="stat-label">Spread %</span><strong>${formatPercent(latest.spPct)}</strong></div>
        <div><span class="stat-label">Volume (24h)</span><strong>${formatNumber(latestHourly?.rolling?.['1d'])}</strong></div>
        <div><span class="stat-label">Volume (7d avg)</span><strong>${formatNumber(latestDaily?.rolling?.['7d'])}</strong></div>
      ` : '<div class="empty-state">No data available.</div>';
    }

    const levelButtons = document.getElementById('level-buttons');
    if (levelButtons) levelButtons.innerHTML = renderLevelButtons();

    const windowButtons = document.getElementById('window-buttons');
    if (windowButtons) windowButtons.innerHTML = renderWindowButtons();

    const pointMeta = document.getElementById('point-meta');
    if (pointMeta) {
      pointMeta.textContent = points.length ? `${points.length} displayed points in ${calcWindowLabel(selectedWindow)}` : `No data available for ${calcWindowLabel(selectedWindow)}`;
    }

    const chartWarning = document.getElementById('chart-warning');
    if (chartWarning) {
      const coverageInfo = getCoverageInfo();
      if (points.length && coverageInfo.isInsufficient) {
        const availableDays = (coverageInfo.availableHours / 24).toFixed(1);
        const requiredDays = (coverageInfo.requiredHours / 24).toFixed(0);
        chartWarning.textContent = `Warning: this range shows only ${availableDays} days of data.`;
        chartWarning.classList.remove('is-hidden');
      } else {
        chartWarning.classList.add('is-hidden');
        chartWarning.textContent = '';
      }
    }

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => renderChartInteractive(), { timeout: 2000 });
    } else {
      setTimeout(renderChartInteractive, 0);
    }
  };

  const enhancementBlock = levelKeys.length > 1 ? `
    <div class="control-group">
      <p class="control-label">Enhancement</p>
      <div id="level-buttons" class="button-row">${renderLevelButtons()}</div>
    </div>
  ` : '';

  // Centered Range selection without label
  const rangeBlock = `
    <div class="range-container">
      <div id="window-buttons" class="button-row">${renderWindowButtons()}</div>
    </div>
  `;

  const iconUrlSvg = resolveIconAssetPath(catalog.iconFiles, slug, 'svg');
  const iconUrlPng = resolveIconAssetPath(catalog.iconFiles, slug, 'png');
  const iconHtml = `<img class="dashboard-icon" src="${iconUrlSvg}" alt="${itemName}" onerror="if(!this._tried){this._tried=true;this.src='${iconUrlPng}'}else{this.style.display='none'}" />`;
  const logoHtmlItem = `<img src="${assetPath('assets/logo.svg')}" alt="Logo" class="item-logo-img" onerror="this.style.display='none'" />`;

  root.innerHTML = `
    <div class="dashboard-layout">
      <a class="minimal-back-link outside-back" href="${SITE_BASE_PATH}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        Back to items
      </a>
      
      <section class="dashboard-card">
        <div class="item-logo-container">${logoHtmlItem}</div>
        <header class="dashboard-header">
          <div class="item-identity">
            ${iconHtml}
            <h1>${escapeHtml(itemName)}</h1>
          </div>
          ${enhancementBlock}
        </header>

        <div class="chart-container">
          <div class="chart-legend">
            <div class="legend-item"><span class="legend-dash ask"></span> Ask</div>
            <div class="legend-item"><span class="legend-dash bid"></span> Bid</div>
          </div>
          <p id="chart-warning" class="chart-warning is-hidden"></p>
          <div id="price-chart"></div>
          <p id="point-meta" class="chart-meta"></p>
        </div>

        ${rangeBlock}

        <div id="item-stats" class="stats-grid"></div>
      </section>
    </div>
  `;

  updateView();

  const rootElement = document.getElementById('app');
  rootElement.addEventListener('click', (event) => {
    const level = event.target.getAttribute('data-level');
    if (level) { selectedLevel = level; updateView(); return; }
    const windowKey = event.target.getAttribute('data-window');
    if (windowKey) { selectedWindow = windowKey; updateView(); }
  });
}

async function main() {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  const route = getRoute();
  try {
    if (route.type === 'item' && route.slug) {
      await renderItem(root, route.slug);
    } else {
      await renderHome(root);
    }

    void registerServiceWorker();
  } catch (error) {
    renderShell(root, 'Market Observatory', `<section class="card"><div class="empty-state">Unable to load data: ${escapeHtml(error.message)}</div></section>`, '');
  }
}

main();
