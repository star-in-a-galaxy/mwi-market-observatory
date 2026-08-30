function getSiteBasePath() {
  if (typeof window.__SITE_BASE__ === 'string' && window.__SITE_BASE__) {
    return window.__SITE_BASE__;
  }

  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length === 0 || segments[0] === 'items' || segments[0] === 'trends') {
    return '/';
  }

  return `/${segments[0]}/`;
}

const SITE_BASE_PATH = getSiteBasePath();
const ROUTE_PREFIX = `${SITE_BASE_PATH}items/`;
const DEFAULT_WINDOW = '15d';

// Filter cache management
const FILTER_CACHE_KEY = 'mwi_home_filters';
const FAVORITES_KEY = 'mwi_favorites';

function saveFilters(category, searchQuery, favoritesOnly) {
  try {
    localStorage.setItem(FILTER_CACHE_KEY, JSON.stringify({ category, searchQuery, favoritesOnly }));
  } catch (e) {
    console.warn('Failed to save filter cache:', e);
  }
}

function loadFilters() {
  try {
    const cached = localStorage.getItem(FILTER_CACHE_KEY);
    return cached ? JSON.parse(cached) : { category: 'all', searchQuery: '', favoritesOnly: false };
  } catch (e) {
    console.warn('Failed to load filter cache:', e);
    return { category: 'all', searchQuery: '', favoritesOnly: false };
  }
}

const TRENDS_FILTER_KEY = 'mwi_trends_filters';

function saveTrendsFilters(windowKey, categories, showEnhanced, favoritesOnly) {
  try {
    localStorage.setItem(TRENDS_FILTER_KEY, JSON.stringify({ window: windowKey, categories, showEnhanced, favoritesOnly }));
  } catch (e) {
    console.warn('Failed to save trends filter cache:', e);
  }
}

function loadTrendsFilters() {
  try {
    const cached = localStorage.getItem(TRENDS_FILTER_KEY);
    return cached ? JSON.parse(cached) : { window: '24h', categories: [], showEnhanced: true, favoritesOnly: false };
  } catch (e) {
    console.warn('Failed to load trends filter cache:', e);
    return { window: '24h', categories: [], showEnhanced: true, favoritesOnly: false };
  }
}

function loadFavorites() {
  try {
    const cached = localStorage.getItem(FAVORITES_KEY);
    const parsed = cached ? JSON.parse(cached) : [];
    return Array.isArray(parsed) ? parsed.map((s) => String(s).toLowerCase()) : [];
  } catch (e) {
    console.warn('Failed to load favorites:', e);
    return [];
  }
}

function saveFavorites(slugs) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(slugs));
  } catch (e) {
    console.warn('Failed to save favorites:', e);
  }
}

function toggleFavorite(slug) {
  const normalized = String(slug).toLowerCase();
  const favorites = loadFavorites();
  const index = favorites.indexOf(normalized);
  let isFavorite = true;
  if (index >= 0) {
    favorites.splice(index, 1);
    isFavorite = false;
  } else {
    favorites.push(normalized);
  }
  saveFavorites(favorites);
  return isFavorite;
}

function favoriteStarHtml(slug, isFavorite, extraClass) {
  const classes = ['favorite-star', isFavorite ? 'is-favorite' : '', extraClass || ''].filter(Boolean).join(' ');
  return `<span class="${classes}" data-fav-slug="${escapeHtml(String(slug).toLowerCase())}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
  </span>`;
}

// Global catalog cache to prevent redundant parsing
let G_CATALOG_CACHE = null;
const WINDOW_CONFIG = {
  '1d': { label: '1 Day', hours: 24 },
  '3d': { label: '3 Days', hours: 24 * 3 },
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

function normalizePublicSeriesPoint(point, kind, previousAsk, previousBid) {
  let timestamp = null;
  let ask = null;
  let bid = null;
  let volume = null;
  let t = null;
  let label = null;

  if (Array.isArray(point)) {
    [timestamp, ask, bid, volume, price] = point;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      const isoString = new Date(timestamp).toISOString();
      t = kind === 'daily' ? isoString.split('T')[0] : isoString;
      label = kind === 'daily' ? formatDayLabel(t) : formatHourLabel(isoString);
    }
  } else if (point && typeof point === 'object') {
    timestamp = typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)
      ? point.timestamp
      : (typeof point.t === 'number' && Number.isFinite(point.t) ? point.t : Date.parse(point.t || point.label || ''));
    ask = typeof point.ask === 'number' ? point.ask : point.a;
    bid = typeof point.bid === 'number' ? point.bid : point.b;
    volume = typeof point.v === 'number' ? point.v : point.volume;
    t = typeof point.t === 'string' ? point.t : null;
    label = typeof point.label === 'string' ? point.label : null;
  }

  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  ask = typeof ask === 'number' && Number.isFinite(ask) && ask > 0 ? ask : null;
  bid = typeof bid === 'number' && Number.isFinite(bid) && bid > 0 ? bid : null;
  volume = typeof volume === 'number' && Number.isFinite(volume) && volume > 0 ? volume : null;
  price = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;

  if (!t) {
    const isoString = new Date(timestamp).toISOString();
    t = kind === 'daily' ? isoString.split('T')[0] : isoString;
  }

  if (!label) {
    label = kind === 'daily'
      ? formatDayLabel(t)
      : formatHourLabel(kind === 'daily' ? `${t}T00:00:00Z` : t);
  }

  const sp = ask != null && bid != null ? ask - bid : null;
  const spPct = sp != null && bid > 0 ? sp / bid : null;
  const retA = ask != null && previousAsk != null && previousAsk > 0 ? (ask / previousAsk) - 1 : null;
  const retB = bid != null && previousBid != null && previousBid > 0 ? (bid / previousBid) - 1 : null;

  return {
    t,
    timestamp,
    label,
    ask,
    bid,
    a: ask,
    b: bid,
    v: volume,
    p: price,
    sp,
    spPct,
    retA,
    retB,
  };
}

function normalizePublicSeries(rawSeries, kind) {
  const normalized = [];
  let previousAsk = null;
  let previousBid = null;

  for (const rawPoint of rawSeries || []) {
    const point = normalizePublicSeriesPoint(rawPoint, kind, previousAsk, previousBid);
    if (!point) continue;

    normalized.push(point);
    if (point.ask != null) previousAsk = point.ask;
    if (point.bid != null) previousBid = point.bid;
  }

  return normalized;
}

function normalizePublicItemData(rawItemData) {
  if (!rawItemData || typeof rawItemData !== 'object') {
    return { levels: [], data: {} };
  }

  const sourceLevels = rawItemData.v === 2 && rawItemData.data && typeof rawItemData.data === 'object'
    ? rawItemData.data
    : (rawItemData.data && typeof rawItemData.data === 'object'
      ? rawItemData.data
      : {});

  const normalizedData = {};

  for (const [level, levelData] of Object.entries(sourceLevels)) {
    if (rawItemData.v === 2 || (levelData && Array.isArray(levelData.d)) || (levelData && Array.isArray(levelData.h))) {
      normalizedData[level] = {
        daily: normalizePublicSeries(levelData?.d || [], 'daily'),
        hourly: normalizePublicSeries(levelData?.h || [], 'hourly'),
        vwap: levelData?.vwap || { p1d: null, p3d: null, p7d: null },
      };
    } else {
      normalizedData[level] = {
        daily: normalizePublicSeries(levelData?.daily || [], 'daily'),
        hourly: normalizePublicSeries(levelData?.hourly || [], 'hourly'),
        vwap: levelData?.vwap || { p1d: null, p3d: null, p7d: null },
      };
    }
  }

  const levels = Array.isArray(rawItemData.levels)
    ? rawItemData.levels.map((level) => String(level))
    : Object.keys(normalizedData).sort((left, right) => Number(left) - Number(right));

  return {
    ...rawItemData,
    levels,
    data: normalizedData,
  };
}

function getTrailingVolume(series, windowMs, mode = 'sum') {
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }

  const latestTimestamp = series[series.length - 1]?.timestamp;
  if (typeof latestTimestamp !== 'number' || !Number.isFinite(latestTimestamp)) {
    return null;
  }

  const cutoff = latestTimestamp - windowMs;
  const relevantPoints = series.filter((point) => typeof point?.timestamp === 'number' && point.timestamp > cutoff);
  if (!relevantPoints.length) {
    return null;
  }

  const volumeSum = relevantPoints.reduce((sum, point) => sum + (typeof point.v === 'number' && point.v > 0 ? point.v : 0), 0);
  if (mode === 'avg') {
    return Math.round(volumeSum / relevantPoints.length);
  }

  return volumeSum;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setHTML(el, html) {
  if (el && window.DOMPurify) {
    el.innerHTML = DOMPurify.sanitize(html);
  } else if (el) {
    el.innerHTML = html;
  }
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
  if (value >= 1e9) return (value / 1e9).toFixed(2).replace(/\.0+$/, '') + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(2).replace(/\.0+$/, '') + 'M';
  if (value >= 100e3) return (value / 1e3).toFixed(0) + 'k';
  if (value >= 1e3) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US');
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
    const slug = decodeURIComponent(cleaned.slice('items/'.length));
    if (!/^[a-z0-9_]+$/.test(slug)) {
      return { type: 'home' };
    }
    return { type: 'item', slug };
  }
  if (cleaned === 'trends') {
    return { type: 'trends' };
  }
  if (cleaned === 'group') {
    return { type: 'group' };
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

const PRICE_TIERS = [
  [50, 1], [100, 2], [300, 5], [500, 10], [1000, 20], [3000, 50],
  [5000, 100], [10000, 200], [30000, 500], [50000, 1000], [100000, 2000], [300000, 5000],
  [500000, 10000], [1000000, 20000], [3000000, 50000], [5000000, 100000], [10000000, 200000], [30000000, 500000],
  [50000000, 1000000], [100000000, 2000000], [300000000, 5000000], [500000000, 10000000], [1000000000, 20000000], [3000000000, 50000000],
  [5000000000, 100000000], [10000000000, 200000000], [30000000000, 500000000], [50000000000, 1000000000], [100000000000, 2000000000]
];

function getPriceStep(price) {
  for (const [maxPrice, step] of PRICE_TIERS) {
    if (price <= maxPrice) return step;
  }
  return PRICE_TIERS[PRICE_TIERS.length - 1][1];
}

function generateAllValidPrices(paddedMin, paddedMax) {
  const prices = [];
  let prevBoundary = 0;

  for (const [bracketMax, step] of PRICE_TIERS) {
    const start = Math.max(paddedMin, prevBoundary);
    const end = Math.min(paddedMax, bracketMax);
    if (start > end) { prevBoundary = bracketMax; continue; }

    let tick = Math.ceil(start / step) * step;
    if (tick === prevBoundary && prevBoundary > 0) tick += step;

    while (tick <= end) {
      prices.push(tick);
      tick += step;
    }

    prevBoundary = bracketMax;
    if (bracketMax >= paddedMax) break;
  }

  return prices;
}

function generatePriceTicks(paddedMin, paddedMax) {
  const all = generateAllValidPrices(paddedMin, paddedMax);
  if (all.length <= 15) return all;

  const tickStep = getSpanTickStep(paddedMin, paddedMax);
  const firstTick = Math.ceil(paddedMin / tickStep) * tickStep;
  const result = [];
  const seen = new Set();
  for (let v = firstTick; v <= paddedMax + tickStep; v += tickStep) {
    const step = getPriceStep(v);
    const snapped = Math.round(v / step) * step;
    if (snapped >= paddedMin && snapped <= paddedMax && !seen.has(snapped)) {
      seen.add(snapped);
      result.push(snapped);
    }
  }

  return result;
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

  const yValues = points.flatMap((point) => [point.ask, point.bid, point.p]).filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
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
    pY: typeof point.p === 'number' && point.p > 0 ? scaleY(point.p) : null,
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
  const priceTicks = generatePriceTicks(paddedMin, paddedMax);

  for (const tickValue of priceTicks) {
    const y = padding.top + (1 - (tickValue - paddedMin) / span) * innerHeight;
    grid.push(`
      <line x1="${firstPriceX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${lastPriceX.toFixed(1)}" y2="${y.toFixed(1)}" class="chart-grid" />
      <text x="${(chartStartX - 12).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-label chart-label-y">${formatCompactNumber(tickValue)}</text>
    `);
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

  // ----------------------------------------------------------------------
  // Volume Weighted Average Price (VP) Line
  // ----------------------------------------------------------------------
  const validVpIdxs = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i]?.p > 0) validVpIdxs.push(i);
  }

  const vpSolidSegs = [];
  const vpDottedSegs = [];

  for (let vi = 0; vi < validVpIdxs.length; vi++) {
    const i = validVpIdxs[vi];
    const x = pointPositions[i].x;
    const y = scaleY(points[i].p).toFixed(1);
    const prevConsecutive = vi > 0 && validVpIdxs[vi - 1] === i - 1;
    vpSolidSegs.push(`${prevConsecutive ? 'L' : 'M'} ${x.toFixed(1)} ${y}`);
  }

  for (let vi = 0; vi < validVpIdxs.length - 1; vi++) {
    const leftIdx = validVpIdxs[vi];
    const rightIdx = validVpIdxs[vi + 1];
    if (rightIdx - leftIdx > 1) {
      const leftX = pointPositions[leftIdx].x;
      const leftY = scaleY(points[leftIdx].p).toFixed(1);
      const lastNullIdx = rightIdx - 1;
      const lastNullX = pointPositions[lastNullIdx].x;
      vpDottedSegs.push(`M ${leftX.toFixed(1)} ${leftY} L ${lastNullX.toFixed(1)} ${leftY}`);
    }
  }

  const vpExtensions = toExtensionPaths((point) => typeof point.p === 'number' && point.p > 0 ? point.p : null);

  const vpLineSvg = vpSolidSegs.length
    ? `<path d="${vpSolidSegs.join(' ')}" class="chart-line chart-line-vp" />`
    : '';
  const vpDottedSvg = vpDottedSegs.length
    ? `<path d="${vpDottedSegs.join(' ')}" class="chart-line chart-line-vp" stroke-dasharray="4 4" stroke-width="2" opacity="0.5" fill="none" />`
    : '';

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
        ${vpLineSvg}
        ${vpDottedSvg}
        ${vpExtensions.left ? `<path d="${vpExtensions.left}" class="chart-line chart-line-vp" stroke-dasharray="3 3" stroke-width="2" opacity="0.3" fill="none" />` : ''}
        ${vpExtensions.right ? `<path d="${vpExtensions.right}" class="chart-line chart-line-vp" stroke-dasharray="3 3" stroke-width="2" opacity="0.3" fill="none" />` : ''}
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
  setHTML(root, `
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
  `);
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
      catalog.iconFiles = catalog.iconFiles || {};
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

function titleCase(str) {
  return str.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

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
    const label = titleCase(fname.replace(/^\d+_/, '').replace(/\.txt$/, '').replace(/_/g, ' '));
    try {
      const res = await fetch(assetPath(`assets/item_categories/${fname}`));
      if (!res.ok) {
        categories.push({ id: i, label, slugs: [] });
        continue;
      }
      const text = await res.text();
      const slugs = text.split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean);
      categories.push({ id: i, label, slugs });
      for (const slug of slugs) {
        if (slug) slugToCategory[slug] = i;
      }
    } catch (err) {
      categories.push({ id: i, label, slugs: [] });
    }
  }

  return { categories, slugToCategory };
}

async function renderHome(root) {
  const catalog = await loadCatalog();
  const items = catalog.items || [];

  const ITEMS_PER_PAGE = 48;

  const renderItemCards = (itemsToRender) => {
    return itemsToRender
      .map((item) => {
        const iconSvg = resolveIconAssetPath(catalog.iconFiles, item.slug, 'svg');
        const iconPng = resolveIconAssetPath(catalog.iconFiles, item.slug, 'png');
          const displayName = (item.name || slugToTitle(item.slug)).replace(/\s+Refined$/, ' (R)');
        return `
      <a class="item-card" href="${itemLink(item.slug)}" loading="lazy">
        <img class="item-icon" src="${iconSvg}" alt="${escapeHtml(item.name || slugToTitle(item.slug))}" data-fallback-src="${iconPng}" />
        <span class="item-card-title">${escapeHtml(displayName)}</span>
        ${favoriteStarHtml(item.slug, favoriteSet.has(String(item.slug).toLowerCase()))}
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
  const cachedFilters = loadFilters();
  let selectedCategories = new Set(cachedFilters.category === 'all' ? [] : Array.isArray(cachedFilters.category) ? cachedFilters.category : [cachedFilters.category]);
  let favoritesOnly = cachedFilters.favoritesOnly === true;
  const favoriteSet = new Set(loadFavorites());
  const filtersHtml = [`<button class="filter-pill ${selectedCategories.size === 0 && !favoritesOnly ? 'active' : ''}" data-index="all">All</button>`, `<button class="filter-pill ${favoritesOnly ? 'active' : ''}" data-index="fav">Favorites</button>`, ...categories.map(c => `<button class="filter-pill ${selectedCategories.has(c.id) ? 'active' : ''}" data-index="${c.id}">${escapeHtml(c.label)}</button>` )].join('');

  const renderFilteredItems = () => {
    setHTML(list, filteredItems.length
      ? renderItemCards(filteredItems)
      : '<div class="empty-state">No items matched that search.</div>');
  };

  const computeFiltered = () => {
    const query = search.value.trim().toLowerCase();
    return sortedItems.filter((item) => {
      if (favoritesOnly) {
        if (!favoriteSet.has(String(item.slug).toLowerCase())) return false;
      } else if (selectedCategories.size > 0) {
        const catIdx = typeof slugToCategory[item.slug] === 'number' ? slugToCategory[item.slug] : null;
        if (!selectedCategories.has(catIdx)) return false;
      }
      const name = (item.name || slugToTitle(item.slug)).toLowerCase();
      return !query || name.includes(query) || item.slug.toLowerCase().includes(query);
    });
  };

  const syncFilterButtons = () => {
    Array.from(filtersContainer.querySelectorAll('button')).forEach((b) => {
      if (b.dataset.index === 'all') {
        b.classList.toggle('active', selectedCategories.size === 0 && !favoritesOnly);
      } else if (b.dataset.index === 'fav') {
        b.classList.toggle('active', favoritesOnly);
      } else {
        b.classList.toggle('active', selectedCategories.has(Number(b.dataset.index)));
      }
    });
  };

  const logoHtml = `<img src="${assetPath('assets/logo.svg')}" alt="Logo" class="hero-logo-img" />`;

  renderShell(
    root,
    'Market Observatory',
    `
      <nav class="group-nav">
        <a class="minimal-back-link" href="${SITE_BASE_PATH}group">Group View</a>
        <a class="minimal-back-link" href="${SITE_BASE_PATH}trends">Trends</a>
      </nav>
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

      if (idx === 'all') {
        selectedCategories.clear();
        favoritesOnly = false;
      } else if (idx === 'fav') {
        favoritesOnly = !favoritesOnly;
        if (favoritesOnly) selectedCategories.clear();
      } else {
        if (favoritesOnly) favoritesOnly = false;
        const catIdx = Number(idx);
        if (selectedCategories.has(catIdx)) {
          selectedCategories.delete(catIdx);
        } else {
          selectedCategories.add(catIdx);
        }
      }

      saveFilters(selectedCategories.size === 0 ? 'all' : [...selectedCategories], search.value.trim().toLowerCase(), favoritesOnly);
      syncFilterButtons();
      filteredItems = computeFiltered();
      renderFilteredItems();
    });
  }

  search.addEventListener('input', () => {
    filteredItems = computeFiltered();

    saveFilters(selectedCategories.size === 0 ? 'all' : [...selectedCategories], search.value.trim().toLowerCase(), favoritesOnly);
    renderFilteredItems();
  });

  list.addEventListener('click', (event) => {
    const star = event.target.closest('.favorite-star');
    if (!star || !star.dataset.favSlug) return;
    event.preventDefault();
    event.stopPropagation();
    const slug = String(star.dataset.favSlug).toLowerCase();
    const isFavorite = toggleFavorite(slug);
    if (isFavorite) favoriteSet.add(slug);
    else favoriteSet.delete(slug);
    filteredItems = computeFiltered();
    renderFilteredItems();
  });

  // Apply cached filters to button states and render
  if (filtersContainer) {
    syncFilterButtons();
  }

  // Filter items based on cached state
  filteredItems = computeFiltered();

  renderFilteredItems();

}

// Delegated favorite-star clicks: toggle in place, never navigate.
document.addEventListener('click', (event) => {
  const star = event.target.closest('.favorite-star');
  if (!star || !star.dataset.favSlug) return;
  event.preventDefault();
  event.stopPropagation();
  const isFavorite = toggleFavorite(star.dataset.favSlug);
  star.classList.toggle('is-favorite', isFavorite);
  star.setAttribute('title', isFavorite ? 'Remove from favorites' : 'Add to favorites');
});

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

const DATA_GAP_START = new Date('2026-06-07T01:00:00Z').getTime();
const DATA_GAP_END = new Date('2026-06-10T16:22:00Z').getTime();

function getDataGapWarningHtml() {
  return '⚠️ Data was not collected between June 7 (03:00) and June 10 (18:22) GMT+2. Values during this period are missing from the chart.';
}

async function renderItem(root, slug) {
  const catalog = await loadCatalog();
  const itemMeta = (catalog.items || []).find((item) => item.slug === slug);
  const itemName = itemMeta?.name || slugToTitle(slug);

  let itemData = null;
  try {
    itemData = normalizePublicItemData(await fetchJson(assetPath(`data/public/items/${encodeURIComponent(slug)}.json`)));
  } catch (error) {
    itemData = null;
  }

  const levels = itemData?.data || {};
  const levelKeys = itemData?.levels || ['0'];
  const defaultLevel = levelKeys.includes('0') ? '0' : levelKeys[0];
  let selectedLevel = defaultLevel;
  let selectedWindow = DEFAULT_WINDOW;

  const syncLevelURL = () => {
    const params = new URLSearchParams(window.location.search);
    if (selectedLevel !== defaultLevel) {
      params.set('level', selectedLevel);
    } else {
      params.delete('level');
    }
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '');
    if (window.location.pathname + window.location.search !== url) {
      history.replaceState(null, '', url);
    }
  };

  const requestedLevel = new URLSearchParams(window.location.search).get('level');
  if (requestedLevel != null && levelKeys.includes(String(requestedLevel))) {
    selectedLevel = String(requestedLevel);
  }

  const renderLevelButtons = () => levelKeys
    .map((level) => `<button class="pill ${level === selectedLevel ? 'active' : ''}" data-level="${escapeHtml(level)}">+${escapeHtml(level)}</button>`)
    .join('');

  const renderWindowButtons = () => Object.keys(WINDOW_CONFIG)
    .map((key) => `<button class="pill ${key === selectedWindow ? 'active' : ''}" data-window="${escapeHtml(key)}">${escapeHtml(WINDOW_CONFIG[key].label)}</button>`)
    .join('');

  const usesDailySeries = (windowKey) => (WINDOW_CONFIG[windowKey]?.hours || 0) >= (24 * 30);

  const displayBucketMsForWindow = (windowKey) => {
    const hourMs = 60 * 60 * 1000;
    if (windowKey === '1d') return 1 * hourMs; 
    if (windowKey === '3d') return 3 * hourMs;
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
      
      // For 1D, if we have 2+ points in the same hour, infer based on neighbor buckets:
      // - If previous hour empty: move 1st point to previous hour
      // - Else if previous exists AND next hour empty: move 2nd point to next hour
      // - Else aggregate both in current hour
      if (windowKey === '1d' && currentBucket && currentBucket.bucketStart === bucketStart && currentBucket.points.length >= 1) {
        const previousBucketStart = bucketStart - bucketMs;
        const nextBucketStart = bucketStart + bucketMs;
        const previousBucketExists = grouped.some((b) => b.bucketStart === previousBucketStart);
        const nextBucketExists = grouped.some((b) => b.bucketStart === nextBucketStart);
        
        if (!previousBucketExists) {
          // Move 1st point to previous bucket
          const firstPoint = currentBucket.points.shift();
          grouped.push({ bucketStart: previousBucketStart, points: [firstPoint] });
          // Current point stays in current bucket
        } else if (previousBucketExists && !nextBucketExists) {
          // Move 2nd point to next bucket
          grouped.push(currentBucket);
          currentBucket = { bucketStart: nextBucketStart, points: [point] };
          continue;
        } else {
          // Aggregate both in current hour
          currentBucket.points.push(point);
          continue;
        }
      }
      
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

      const totalPV = bucketPoints.reduce((sum, pt) => sum + (pt.p > 0 && pt.v > 0 ? pt.p * pt.v : 0), 0);
      const totalV = bucketPoints.reduce((sum, pt) => sum + (pt.p > 0 && pt.v > 0 ? pt.v : 0), 0);
      const vp = totalV > 0 ? Math.round(totalPV / totalV) : (representative.p > 0 ? representative.p : null);

      return { ...representative, t: timestamp, timestamp, label, ask, bid, a: ask, b: bid, v: volume, p: vp, sp: spread, spPct: spreadPct };
    });
  };

  const currentSeries = () => {
    const levelData = levels[selectedLevel] || {};
    const series = usesDailySeries(selectedWindow) ? (levelData.daily || []) : (levelData.hourly || []);
    
    // For 30d/60d/90d/120d, use daily series but append hourly data for the last bucket
    if (['30d', '60d', '90d', '120d'].includes(selectedWindow) && usesDailySeries(selectedWindow)) {
      const dailySeries = levelData.daily || [];
      const hourlySeries = levelData.hourly || [];
      if (dailySeries.length > 0 && hourlySeries.length > 0) {
        const bucketMs = displayBucketMsForWindow(selectedWindow);
        const now = Date.now();
        const todayStart = Math.floor(now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        const lastBucketStart = Math.floor(todayStart / bucketMs) * bucketMs;
        
        // Include all daily data before the last bucket, then append hourly data from last bucket start
        const dailyBeforeBucket = dailySeries.filter((point) => point?.timestamp && point.timestamp < lastBucketStart);
        const hourlyFromLastBucket = hourlySeries.filter((point) => point?.timestamp && point.timestamp >= lastBucketStart);
        
        if (hourlyFromLastBucket.length > 0) {
          return [...dailyBeforeBucket, ...hourlyFromLastBucket];
        }
      }
    }
    return series;
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
    setHTML(chart, chartData.html);
    
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
        setHTML(chartHover, `
          <div class="chart-hover-date">${escapeHtml(point.label)}</div>
          <div class="chart-hover-row"><span>Ask: </span><strong>${formatCurrency(point.a)}</strong></div>
          <div class="chart-hover-row"><span>Bid: </span><strong>${formatCurrency(point.b)}</strong></div>
          <div class="chart-hover-row"><span>Spread: </span><strong>${formatCurrency(point.sp)}</strong></div>
          <div class="chart-hover-row"><span>Spread %: </span><strong>${formatPercent(point.spPct)}</strong></div>
          <div class="chart-hover-row"><span>Volume: </span><strong>${formatNumber(point.v)}</strong></div>
          <div class="chart-hover-row"><span>VWAP: </span><strong>${formatCurrency(point.p)}</strong></div>
        `);
      };

      chartWrap.onmouseleave = hideHover;
      chartWrap.onmousemove = (event) => showHoverForClientX(event.clientX);
    }
  };

  const updateView = () => {
    const points = currentPoints();
    const stats = document.getElementById('item-stats');
    const latest = points[points.length - 1];
    const currentLevel = levels[selectedLevel] || {};
    const hourlySeries = currentLevel.hourly || [];
    const dailySeries = currentLevel.daily || [];
    const latestHourly = hourlySeries.at(-1) || null;
    const latestDaily = dailySeries.at(-1) || null;
    const hourlyVolume24h = getTrailingVolume(hourlySeries, 24 * 60 * 60 * 1000, 'sum');
    const dailyVolume7dAvg = getTrailingVolume(dailySeries, 7 * 24 * 60 * 60 * 1000, 'avg');

    if (stats) {
      const vwap = currentLevel.vwap || { p1d: null, p7d: null };
      setHTML(stats, latest ? `
        <div><span class="stat-label">Ask</span><strong>${formatNumber(latest.a)}</strong></div>
        <div><span class="stat-label">Bid</span><strong>${formatNumber(latest.b)}</strong></div>
        <div><span class="stat-label">1d VWAP</span><strong>${formatNumber(vwap.p1d)}</strong></div>
        <div><span class="stat-label">7d VWAP</span><strong>${formatNumber(vwap.p7d)}</strong></div>
        <div><span class="stat-label">Volume (24h)</span><strong>${formatNumber(hourlyVolume24h)}</strong></div>
        <div><span class="stat-label">Volume (7d avg)</span><strong>${formatNumber(dailyVolume7dAvg)}</strong></div>
      ` : '<div class="empty-state">No data available.</div>');
    }

    const levelButtons = document.getElementById('level-buttons');
    if (levelButtons) setHTML(levelButtons, renderLevelButtons());

    const windowButtons = document.getElementById('window-buttons');
    if (windowButtons) setHTML(windowButtons, renderWindowButtons());

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

    const gapWarning = document.getElementById('data-gap-warning');
    if (gapWarning) {
      const firstTs = points[0]?.timestamp;
      const lastTs = points[points.length - 1]?.timestamp;
      if (firstTs && lastTs && firstTs < DATA_GAP_END && lastTs > DATA_GAP_START) {
        gapWarning.textContent = getDataGapWarningHtml();
        gapWarning.classList.remove('is-hidden');
      } else {
        gapWarning.classList.add('is-hidden');
        gapWarning.textContent = '';
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
  const iconHtml = `<img class="dashboard-icon" src="${iconUrlSvg}" alt="${itemName}" data-fallback-src="${iconUrlPng}" />`;
  const logoHtmlItem = `<img src="${assetPath('assets/logo.svg')}" alt="Logo" class="item-logo-img" />`;

  setHTML(root, `
    <div class="dashboard-layout">
      <nav class="group-nav outside-back">
        <a class="minimal-back-link" href="${SITE_BASE_PATH}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          Home
        </a>
        <a class="minimal-back-link" href="${SITE_BASE_PATH}group">Group View</a>
        <a class="minimal-back-link" href="${SITE_BASE_PATH}trends">Trends</a>
      </nav>
      
      <section class="dashboard-card">
        <div class="item-logo-container">${logoHtmlItem}</div>
        <header class="dashboard-header">
          <div class="item-identity">
            ${iconHtml}
            ${favoriteStarHtml(slug, loadFavorites().includes(String(slug).toLowerCase()), 'item-page-star')}
            <h1>${escapeHtml(itemName)}</h1>
          </div>
          ${enhancementBlock}
        </header>

        <div class="chart-container">
          <div class="chart-legend">
            <div class="legend-item"><span class="legend-dash ask"></span> Ask</div>
            <div class="legend-item"><span class="legend-dash bid"></span> Bid</div>
            <div class="legend-item"><span class="legend-dash vp"></span> Volume Weighted Average Price (VWAP)</div>
          </div>
          <p id="chart-warning" class="chart-warning is-hidden"></p>
          <div id="data-gap-warning" class="data-gap-warning is-hidden"></div>
          <div id="price-chart"></div>
          <p id="point-meta" class="chart-meta"></p>
        </div>

        ${rangeBlock}

        <div id="item-stats" class="stats-grid"></div>
      </section>
    </div>
  `);

  updateView();
  syncLevelURL();

  const rootElement = document.getElementById('app');
  rootElement.addEventListener('click', (event) => {
    const level = event.target.getAttribute('data-level');
    if (level) { selectedLevel = level; syncLevelURL(); updateView(); return; }
    const windowKey = event.target.getAttribute('data-window');
    if (windowKey) { selectedWindow = windowKey; updateView(); }
  });
}

// ─── Group View ─────────────────────────────────────────────

async function renderGroup(root) {
  const LS_KEY = 'mwi_group_view';
  const PRESETS_KEY = 'mwi_group_presets';
  const MAX_CELLS = 24;

  let catalog = await loadCatalog();
  let state = loadGroupState();
  let itemCache = {};
  let groupWindow = '15d';
  let currentPresetIndex = -1;

  function loadGroupState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.cells) && parsed.cells.length <= MAX_CELLS && parsed.cells.length > 0) {
          return parsed;
        }
      }
    } catch (e) { /* fall through */ }
    return { cells: [{ slug: null, level: null }, { slug: null, level: null }] };
  }

  function saveGroupState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through */ }
    return [];
  }

  function savePresets(presets) {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    } catch (e) { /* ignore */ }
  }

  function capturePresetCells() {
    return state.cells.map((c) => ({ slug: c.slug, level: c.level }));
  }

  function savePresetWithName(name) {
    const presets = loadPresets();
    presets.push({ name, cells: capturePresetCells(), window: groupWindow });
    savePresets(presets);
    return presets.length - 1;
  }

  function deletePreset(index) {
    const presets = loadPresets();
    if (index >= 0 && index < presets.length) {
      presets.splice(index, 1);
      savePresets(presets);
      if (index < currentPresetIndex) currentPresetIndex -= 1;
      else if (index === currentPresetIndex) currentPresetIndex = -1;
      updateCurrentPresetUI();
    }
  }

  function loadPreset(index) {
    const presets = loadPresets();
    if (index < 0 || index >= presets.length) return;
    const preset = presets[index];
    state.cells = preset.cells.map((c) => ({ slug: c.slug, level: c.level }));
    groupWindow = preset.window || '15d';
    currentPresetIndex = index;
    saveGroupState();
    updateCurrentPresetUI();
    const row = root.querySelector('.range-container .button-row');
    if (row) setHTML(row, renderWindowButtons());
    reRenderGrid();
  }

  function updateCurrentPresetUI() {
    const el = root.querySelector('.group-current-preset');
    if (!el) return;
    const presets = loadPresets();
    const preset = currentPresetIndex >= 0 && currentPresetIndex < presets.length ? presets[currentPresetIndex] : null;
    if (preset) {
      const nameEl = root.querySelector('.group-current-preset-name');
      if (nameEl) nameEl.textContent = preset.name;
      el.classList.remove('is-hidden');
    } else {
      el.classList.add('is-hidden');
    }
  }

  function renderPresetsHTML() {
    const presets = loadPresets();
    if (!presets.length) {
      return '<div class="group-preset-item disabled">No saved presets</div>';
    }
    return presets.map((p, i) =>
      `<div class="group-preset-item" data-preset-index="${i}">
        <span class="group-preset-handle" draggable="true" title="Drag to reorder"><svg width="16" height="20" viewBox="0 0 16 20" fill="none"><circle cx="5" cy="3" r="1.5" fill="currentColor"/><circle cx="11" cy="3" r="1.5" fill="currentColor"/><circle cx="5" cy="10" r="1.5" fill="currentColor"/><circle cx="11" cy="10" r="1.5" fill="currentColor"/><circle cx="5" cy="17" r="1.5" fill="currentColor"/><circle cx="11" cy="17" r="1.5" fill="currentColor"/></svg></span>
        <span class="group-preset-name" data-preset-load="${i}">${escapeHtml(p.name)}</span>
        <button class="group-preset-delete" data-preset-delete="${i}" title="Delete preset">&times;</button>
      </div>`
    ).join('');
  }

  function renderWindowButtons() {
    return Object.keys(WINDOW_CONFIG)
      .map((k) => `<button class="pill ${k === groupWindow ? 'active' : ''}" data-window="${escapeHtml(k)}">${escapeHtml(WINDOW_CONFIG[k].label)}</button>`)
      .join('');
  }

  function displayBucketMsForWindow(wk) {
    const h = 60 * 60 * 1000;
    if (wk === '1d') return 1 * h;
    if (wk === '3d') return 3 * h;
    if (wk === '7d') return 6 * h;
    if (wk === '15d') return 12 * h;
    if (wk === '30d') return 24 * h;
    if (wk === '60d') return 48 * h;
    if (wk === '90d') return 72 * h;
    if (wk === '120d') return 96 * h;
    return 24 * h;
  }

  function aggregateDisplaySeries(series, wk) {
    const bucketMs = displayBucketMsForWindow(wk);
    if (!bucketMs) return series.map((p) => ({ ...p }));
    const grouped = [];
    let currentBucket = null;
    for (const point of series) {
      if (!point || typeof point.timestamp !== 'number') continue;
      const bucketStart = Math.floor(point.timestamp / bucketMs) * bucketMs;
      if (wk === '1d' && currentBucket && currentBucket.bucketStart === bucketStart && currentBucket.points.length >= 1) {
        const prevStart = bucketStart - bucketMs;
        const nextStart = bucketStart + bucketMs;
        const prevExists = grouped.some((b) => b.bucketStart === prevStart);
        const nextExists = grouped.some((b) => b.bucketStart === nextStart);
        if (!prevExists) {
          const firstPoint = currentBucket.points.shift();
          grouped.push({ bucketStart: prevStart, points: [firstPoint] });
        } else if (prevExists && !nextExists) {
          grouped.push(currentBucket);
          currentBucket = { bucketStart: nextStart, points: [point] };
          continue;
        } else {
          currentBucket.points.push(point);
          continue;
        }
      }
      if (!currentBucket || currentBucket.bucketStart !== bucketStart) {
        if (currentBucket) grouped.push(currentBucket);
        currentBucket = { bucketStart, points: [point] };
      } else {
        currentBucket.points.push(point);
      }
    }
    if (currentBucket) grouped.push(currentBucket);
    return grouped.map(({ bucketStart, points: pts }) => {
      const rep = pts[pts.length - 1];
      const lastAsk = [...pts].reverse().find((p) => typeof p.ask === 'number' && Number.isFinite(p.ask) && p.ask > 0) || null;
      const lastBid = [...pts].reverse().find((p) => typeof p.bid === 'number' && Number.isFinite(p.bid) && p.bid > 0) || null;
      const timestamp = bucketStart;
      const volume = pts.reduce((s, p) => s + (typeof p.v === 'number' && p.v > 0 ? p.v : 0), 0);
      const ask = lastAsk ? lastAsk.ask : null;
      const bid = lastBid ? lastBid.bid : null;
      const spread = ask != null && bid != null ? ask - bid : null;
      const spreadPct = spread != null && bid > 0 ? spread / bid : null;
      const startDate = new Date(bucketStart);
      const endDate = new Date(bucketStart + bucketMs - 1);
      const label = bucketMs > 24 * 60 * 60 * 1000
        ? `${formatDayLabel(startDate.toISOString().split('T')[0])} - ${formatDayLabel(endDate.toISOString().split('T')[0])}`
        : (bucketMs >= 24 * 60 * 60 * 1000
            ? formatDayLabel(startDate.toISOString().split('T')[0])
            : formatHourLabel(new Date(timestamp).toISOString()));
      const totalPV = pts.reduce((s, pt) => s + (pt.p > 0 && pt.v > 0 ? pt.p * pt.v : 0), 0);
      const totalV = pts.reduce((s, pt) => s + (pt.p > 0 && pt.v > 0 ? pt.v : 0), 0);
      const vp = totalV > 0 ? Math.round(totalPV / totalV) : (rep.p > 0 ? rep.p : null);
      return { ...rep, t: timestamp, timestamp, label, ask, bid, a: ask, b: bid, v: volume, p: vp, sp: spread, spPct: spreadPct };
    });
  }

  function renderCellEmpty(index) {
    const dragIcon = '<svg width="16" height="20" viewBox="0 0 16 20" fill="none"><circle cx="5" cy="3" r="1.5" fill="currentColor"/><circle cx="11" cy="3" r="1.5" fill="currentColor"/><circle cx="5" cy="10" r="1.5" fill="currentColor"/><circle cx="11" cy="10" r="1.5" fill="currentColor"/><circle cx="5" cy="17" r="1.5" fill="currentColor"/><circle cx="11" cy="17" r="1.5" fill="currentColor"/></svg>';
    return `
      <div class="group-cell" data-cell-index="${index}">
        <span class="cell-drag-handle" draggable="true" data-cell-index="${index}" title="Drag to reorder">${dragIcon}</span>
        <div class="group-cell-empty" data-cell-index="${index}">
          <input class="group-cell-search-input" type="text" placeholder="Search item..." data-cell-index="${index}" autocomplete="off" />
          <div class="group-search-dropdown is-hidden" data-cell-index="${index}"></div>
        </div>
      </div>
    `;
  }

  function renderCellHeaderHTML(cell, index) {
    const meta = (catalog.items || []).find((m) => m.slug === cell.slug);
    const name = meta?.name || slugToTitle(cell.slug);
    const svg = resolveIconAssetPath(catalog.iconFiles, cell.slug, 'svg');
    const png = resolveIconAssetPath(catalog.iconFiles, cell.slug, 'png');
    const dragIcon = '<svg width="16" height="20" viewBox="0 0 16 20" fill="none"><circle cx="5" cy="3" r="1.5" fill="currentColor"/><circle cx="11" cy="3" r="1.5" fill="currentColor"/><circle cx="5" cy="10" r="1.5" fill="currentColor"/><circle cx="11" cy="10" r="1.5" fill="currentColor"/><circle cx="5" cy="17" r="1.5" fill="currentColor"/><circle cx="11" cy="17" r="1.5" fill="currentColor"/></svg>';
    return `
      <div class="group-cell-header">
        <span class="cell-drag-handle" draggable="true" data-cell-index="${index}" title="Drag to reorder">${dragIcon}</span>
        <button class="group-cell-remove" data-cell-index="${index}" title="Remove">&times;</button>
        <img class="group-cell-icon" src="${svg}" alt="${escapeHtml(name)}" data-fallback-src="${png}" />
        <span class="group-cell-name" data-cell-index="${index}" data-slug="${escapeHtml(cell.slug)}">${escapeHtml(name)}</span>
      </div>
    `;
  }

  function renderCellLevelsHTML(cell, index) {
    const keys = cell._levelKeys;
    if (!keys || keys.length <= 1) return '';
    return `
      <div class="group-cell-levels" data-cell-index="${index}">
        ${keys.map((lv) => `<button class="pill ${lv === cell.level ? 'active' : ''}" data-level="${escapeHtml(lv)}" data-cell-index="${index}">+${escapeHtml(lv)}</button>`).join('')}
      </div>
    `;
  }

  function renderGridHTML() {
    const cells = state.cells.map((c, i) => {
      if (c.slug) {
        const levelsHTML = renderCellLevelsHTML(c, i);
        return `
          <div class="group-cell" data-cell-index="${i}">
            ${renderCellHeaderHTML(c, i)}
            <div class="group-cell-chart-wrap" data-cell-index="${i}"><div class="chart-wrap" style="position:relative"></div></div>
            ${levelsHTML}
          </div>
        `;
      }
      return renderCellEmpty(i);
    });
    const addBtn = state.cells.length < MAX_CELLS
      ? `<button class="group-add-cell" data-action="add">+ Add Item</button>`
      : '';
    return `<div class="group-grid">${cells.join('')}${addBtn}</div>`;
  }

  // ── Initial render ──
  root.className = 'shell shell-wide';
  setHTML(root, `
    <header class="hero">
      <p class="kicker">Milky Way Idle</p>
      <div class="hero-title">
        <div>
          <h1>Group View</h1>
          <p class="status">Compare multiple items side by side</p>
        </div>
      </div>
      <div class="hero-logo">
        <img src="${assetPath('assets/logo.svg')}" alt="Logo" class="hero-logo-img" />
      </div>
    </header>
    <nav class="group-nav">
      <a class="minimal-back-link" href="${SITE_BASE_PATH}">&#8592; Home</a>
      <a class="minimal-back-link" href="${SITE_BASE_PATH}trends">Trends</a>
      <span class="group-nav-sep"></span>
      <div class="group-preset-controls">
        <div class="group-preset-buttons">
          <button class="pill group-save-btn" data-action="save-preset">+ Save Preset</button>
          <div class="group-preset-wrap">
            <button class="pill group-load-btn" data-action="toggle-presets">Load &#9660;</button>
            <div class="group-preset-dropdown is-hidden"></div>
          </div>
        </div>
        <div class="group-current-preset is-hidden">
          <span>Current: <strong class="group-current-preset-name"></strong></span>
          <button class="pill group-overwrite-btn" data-action="overwrite-preset">Overwrite</button>
        </div>
      </div>
    </nav>
    <div class="range-container">
      <div class="button-row">${renderWindowButtons()}</div>
      <button class="group-clear-all" data-action="clear-all">Clear All</button>
    </div>
    <section class="card group-view-card">
      ${renderGridHTML()}
    </section>
  `);

  // ── Event delegation ──
  root.addEventListener('click', handleClick);
  root.addEventListener('input', handleInput);
  root.addEventListener('focusout', handleBlur);

  // Drag & drop (desktop)
  let dragSourceIdx = -1;
  let dragPreview = null;
  root.addEventListener('dragstart', handleDragStart);
  root.addEventListener('dragover', handleDragOver);
  root.addEventListener('dragleave', handleDragLeave);
  root.addEventListener('drop', handleDrop);
  root.addEventListener('dragend', handleDragEnd);
  // Touch drag (mobile)
  root.addEventListener('touchstart', handleTouchStart, { passive: false });
  root.addEventListener('touchmove', handleTouchMove, { passive: false });
  root.addEventListener('touchend', handleTouchEnd);
  root.addEventListener('touchcancel', handleTouchCancel);
  // Preset drag & drop (desktop + touch)
  let presetDragIndex = -1;
  let presetDragPreview = null;
  root.addEventListener('dragstart', handlePresetDragStart);
  root.addEventListener('dragover', handlePresetDragOver);
  root.addEventListener('dragleave', handlePresetDragLeave);
  root.addEventListener('drop', handlePresetDrop);
  root.addEventListener('dragend', handlePresetDragEnd);
  root.addEventListener('touchstart', handlePresetTouchStart, { passive: false });
  root.addEventListener('touchmove', handlePresetTouchMove, { passive: false });
  root.addEventListener('touchend', handlePresetTouchEnd);
  root.addEventListener('touchcancel', handlePresetTouchCancel);

  // Close preset dropdown on outside click
  document.addEventListener('click', function closePresetDD(e) {
    const wrap = root.querySelector('.group-preset-wrap');
    if (wrap && !wrap.contains(e.target)) {
      const dd = root.querySelector('.group-preset-dropdown');
      if (dd) dd.classList.add('is-hidden');
    }
  });

  // ── Load charts ──
  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i].slug) await renderCellChart(i);
  }

  // ── Helpers ──

  function handleClick(e) {
    const btnWindow = e.target.closest('[data-window]');
    if (btnWindow) {
      groupWindow = btnWindow.getAttribute('data-window');
      saveGroupState();
      const row = root.querySelector('.range-container .button-row');
      if (row) setHTML(row, renderWindowButtons());
      reRenderAllCharts();
      return;
    }

    const removeBtn = e.target.closest('.group-cell-remove');
    if (removeBtn) {
      const idx = parseInt(removeBtn.getAttribute('data-cell-index'), 10);
      if (!isNaN(idx) && idx >= 0 && idx < state.cells.length) {
        if (state.cells.length > 1) {
          state.cells.splice(idx, 1);
        } else {
          state.cells[0] = { slug: null, level: null };
        }
        saveGroupState();
        reRenderGrid();
      }
      return;
    }

    const levelBtn = e.target.closest('.group-cell-levels .pill');
    if (levelBtn) {
      const idx = parseInt(levelBtn.getAttribute('data-cell-index'), 10);
      const level = levelBtn.getAttribute('data-level');
      if (!isNaN(idx) && level) {
        state.cells[idx].level = level;
        saveGroupState();
        renderCellChart(idx);
      }
      return;
    }

    const addBtn = e.target.closest('.group-add-cell');
    if (addBtn) {
      if (state.cells.length < MAX_CELLS) {
        state.cells.push({ slug: null, level: null });
        saveGroupState();
        reRenderGrid();
      }
      return;
    }

    const clearAllBtn = e.target.closest('.group-clear-all');
    if (clearAllBtn) {
      state.cells = [{ slug: null, level: null }];
      saveGroupState();
      currentPresetIndex = -1;
      updateCurrentPresetUI();
      reRenderGrid();
      return;
    }

    const saveBtn = e.target.closest('[data-action="save-preset"]');
    if (saveBtn) {
      const name = prompt('Preset name:');
      if (name && name.trim()) {
        currentPresetIndex = savePresetWithName(name.trim());
        updateCurrentPresetUI();
        const dd = root.querySelector('.group-preset-dropdown');
        if (dd) setHTML(dd, renderPresetsHTML());
      }
      return;
    }

    const overwriteBtn = e.target.closest('[data-action="overwrite-preset"]');
    if (overwriteBtn) {
      const presets = loadPresets();
      if (currentPresetIndex >= 0 && currentPresetIndex < presets.length) {
        presets[currentPresetIndex] = { name: presets[currentPresetIndex].name, cells: capturePresetCells(), window: groupWindow };
        savePresets(presets);
        updateCurrentPresetUI();
        const dd = root.querySelector('.group-preset-dropdown');
        if (dd) setHTML(dd, renderPresetsHTML());
      }
      return;
    }

    const toggleBtn = e.target.closest('[data-action="toggle-presets"]');
    if (toggleBtn) {
      const dd = root.querySelector('.group-preset-dropdown');
      if (dd) {
        setHTML(dd, renderPresetsHTML());
        dd.classList.toggle('is-hidden');
      }
      return;
    }

    const loadEl = e.target.closest('[data-preset-load]');
    if (loadEl) {
      const idx = parseInt(loadEl.getAttribute('data-preset-load'), 10);
      if (!isNaN(idx)) {
        loadPreset(idx);
        const dd = root.querySelector('.group-preset-dropdown');
        if (dd) dd.classList.add('is-hidden');
      }
      return;
    }

    const delBtn = e.target.closest('[data-preset-delete]');
    if (delBtn) {
      const idx = parseInt(delBtn.getAttribute('data-preset-delete'), 10);
      if (!isNaN(idx)) {
        deletePreset(idx);
        const dd = root.querySelector('.group-preset-dropdown');
        if (dd) setHTML(dd, renderPresetsHTML());
      }
      return;
    }

    const resultBtn = e.target.closest('.group-search-result');
    if (resultBtn) {
      const idx = parseInt(resultBtn.getAttribute('data-cell-index'), 10);
      const slug = resultBtn.getAttribute('data-slug');
      if (!isNaN(idx) && slug) {
        // Fetch item data to check levels before rendering
        selectAndRenderCell(idx, slug);
      }
      return;
    }

    const nameEl = e.target.closest('.group-cell-name');
    if (nameEl) {
      const slug = nameEl.getAttribute('data-slug');
      if (slug) window.location.href = `${SITE_BASE_PATH}items/${encodeURIComponent(slug)}`;
      return;
    }

    const emptyCell = e.target.closest('.group-cell-empty');
    if (emptyCell) {
      const input = emptyCell.querySelector('.group-cell-search-input');
      if (input && e.target !== input) input.focus();
      return;
    }
  }

  function handleInput(e) {
    const input = e.target.closest('.group-cell-search-input');
    if (!input) return;
    const idx = parseInt(input.getAttribute('data-cell-index'), 10);
    if (isNaN(idx)) return;
    const query = input.value.trim().toLowerCase();
    const dropdown = root.querySelector(`.group-search-dropdown[data-cell-index="${idx}"]`);
    if (!dropdown) return;
    if (!query) {
      dropdown.classList.add('is-hidden');
      setHTML(dropdown, '');
      return;
    }
    const matches = (catalog.items || []).filter((item) => {
      const name = (item.name || slugToTitle(item.slug)).toLowerCase();
      return name.includes(query);
    }).slice(0, 30);
    if (!matches.length) {
      dropdown.classList.add('is-hidden');
      setHTML(dropdown, '');
      return;
    }
    setHTML(dropdown, matches.map((item) => {
      const itemName = item.name || slugToTitle(item.slug);
      const iconSvg = resolveIconAssetPath(catalog.iconFiles, item.slug, 'svg');
      const iconPng = resolveIconAssetPath(catalog.iconFiles, item.slug, 'png');
      return `<button class="group-search-result" data-cell-index="${idx}" data-slug="${escapeHtml(item.slug)}">
        <img class="group-search-icon" src="${iconSvg}" alt="" data-fallback-src="${iconPng}" />
        <span>${escapeHtml(itemName)}</span>
      </button>`;
    }).join(''));
    dropdown.classList.remove('is-hidden');
    const inputRect = input.getBoundingClientRect();
    const emptyRect = dropdown.closest('.group-cell-empty').getBoundingClientRect();
    dropdown.style.left = `${inputRect.left - emptyRect.left}px`;
    dropdown.style.top = `${inputRect.bottom - emptyRect.top + 2}px`;
    dropdown.style.width = `${inputRect.width}px`;
  }

  function handleBlur(e) {
    const input = e.target.closest('.group-cell-search-input');
    if (!input) return;
    setTimeout(() => {
      const idx = parseInt(input.getAttribute('data-cell-index'), 10);
      if (isNaN(idx)) return;
      const dropdown = root.querySelector(`.group-search-dropdown[data-cell-index="${idx}"]`);
      if (dropdown) dropdown.classList.add('is-hidden');
    }, 200);
  }

  // ── Drag & Drop handlers (desktop) ──

  function handleDragStart(e) {
    const handle = e.target.closest('.cell-drag-handle');
    if (!handle) return;
    const cell = handle.closest('.group-cell');
    if (!cell) return;
    dragSourceIdx = parseInt(handle.getAttribute('data-cell-index'), 10);
    if (isNaN(dragSourceIdx)) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragSourceIdx));
    cell.classList.add('dragging');
    // Custom drag ghost image
    const clone = cell.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.top = '-9999px';
    clone.style.left = '-9999px';
    clone.style.width = cell.offsetWidth + 'px';
    clone.style.background = 'var(--bg-panel)';
    clone.style.border = '2px solid var(--accent-cyan)';
    clone.style.borderRadius = '16px';
    clone.style.opacity = '0.85';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, Math.round(clone.offsetWidth / 2), 20);
    requestAnimationFrame(() => clone.remove());
  }

  function handleDragOver(e) {
    if (presetDragIndex >= 0) return;
    const grid = root.querySelector('.group-grid');
    if (!grid) return;
    // Allow drops inside the card padding (which is inside root)
    // rather than requiring e.target to be inside the grid itself.
    // The card has padding, so left/right of cells targets the card, not the grid.
    if (!root.contains(e.target)) return;
    // Clamp mouse coords to grid bounds so we don't show a line far outside
    const gridR = grid.getBoundingClientRect();
    const margin = 30;
    const cx = Math.min(Math.max(e.clientX, gridR.left - margin), gridR.right + margin);
    const cy = Math.min(Math.max(e.clientY, gridR.top - margin), gridR.bottom + margin);
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.group-cell').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-center'));
    hideDropLine();
    const cell = e.target.closest('.group-cell');
    if (cell) {
      const r = cell.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (y < 0.25) cell.classList.add('drop-before');
      else if (y > 0.75) cell.classList.add('drop-after');
      else cell.classList.add('drop-center');
    } else {
      showDropLine(findInsertionIndex(cx, cy), cx, cy);
    }
  }

  function handleDragLeave(e) {
    const cell = e.target.closest('.group-cell');
    if (cell) {
      const related = e.relatedTarget;
      if (related && cell.contains(related)) return;
      cell.classList.remove('drop-before', 'drop-after', 'drop-center');
    }
    // Hide the drop line when leaving the grid area (including padding margin)
    const grid = root.querySelector('.group-grid');
    if (grid) {
      const gridR = grid.getBoundingClientRect();
      const margin = 30;
      const inside = e.clientX >= gridR.left - margin && e.clientX <= gridR.right + margin &&
                     e.clientY >= gridR.top - margin && e.clientY <= gridR.bottom + margin;
      const rel = e.relatedTarget;
      if (rel && grid.contains(rel)) return;
      if (!inside) hideDropLine();
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    if (dragSourceIdx < 0) { dropCleanup(); return; }
    const cell = e.target.closest('.group-cell');
    if (cell) {
      const tgtIdx = parseInt(cell.getAttribute('data-cell-index'), 10);
      if (!isNaN(tgtIdx) && tgtIdx !== dragSourceIdx) {
        performReorder(dragSourceIdx, tgtIdx, e.clientY, cell);
      }
    } else {
      // Accept drops anywhere in the grid area (including card padding around the grid)
      const grid = root.querySelector('.group-grid');
      const gridR = grid?.getBoundingClientRect();
      const margin = 30;
      const inGridArea = gridR && e.clientX >= gridR.left - margin && e.clientX <= gridR.right + margin &&
                         e.clientY >= gridR.top - margin && e.clientY <= gridR.bottom + margin;
      if (inGridArea) {
        const insertIdx = findInsertionIndex(e.clientX, e.clientY);
        if (insertIdx >= 0) {
          const [moved] = state.cells.splice(dragSourceIdx, 1);
          const adj = dragSourceIdx < insertIdx ? insertIdx - 1 : insertIdx;
          state.cells.splice(adj, 0, moved);
          saveGroupState();
          reRenderGrid();
        }
      }
    }
    dropCleanup();
  }

  function handleDragEnd() { dropCleanup(); }

  function dropCleanup() {
    dragSourceIdx = -1;
    if (dragPreview) { dragPreview.remove(); dragPreview = null; }
    root.querySelectorAll('.group-cell').forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-center'));
    hideDropLine();
  }

  // ── Touch drag handlers (mobile) ──

  function handleTouchStart(e) {
    const handle = e.target.closest('.cell-drag-handle');
    if (!handle) return;
    const cell = handle.closest('.group-cell');
    if (!cell) return;
    dragSourceIdx = parseInt(handle.getAttribute('data-cell-index'), 10);
    if (isNaN(dragSourceIdx)) { dragSourceIdx = -1; return; }
    cell.classList.add('dragging');
    dragPreview = cell.cloneNode(true);
    dragPreview.className = 'group-cell drag-preview';
    dragPreview.style.position = 'fixed';
    dragPreview.style.pointerEvents = 'none';
    dragPreview.style.zIndex = '9999';
    dragPreview.style.width = cell.offsetWidth + 'px';
    dragPreview.style.left = '-9999px';
    dragPreview.style.top = '-9999px';
    document.body.appendChild(dragPreview);
  }

  function handleTouchMove(e) {
    if (dragSourceIdx < 0) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (dragPreview) {
      dragPreview.style.left = (touch.clientX - dragPreview.offsetWidth / 2) + 'px';
      dragPreview.style.top = (touch.clientY - Math.min(dragPreview.offsetHeight, 60)) + 'px';
    }
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    root.querySelectorAll('.group-cell').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-center'));
    hideDropLine();
    const cell = target?.closest('.group-cell');
    if (cell) {
      const r = cell.getBoundingClientRect();
      const y = (touch.clientY - r.top) / r.height;
      if (y < 0.25) cell.classList.add('drop-before');
      else if (y > 0.75) cell.classList.add('drop-after');
      else cell.classList.add('drop-center');
    } else if (target?.closest('.group-grid')) {
      showDropLine(findInsertionIndex(touch.clientX, touch.clientY));
    }
  }

  function handleTouchEnd(e) {
    if (dragSourceIdx < 0) return;
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const cell = target?.closest('.group-cell');
    if (cell) {
      const tgtIdx = parseInt(cell.getAttribute('data-cell-index'), 10);
      if (!isNaN(tgtIdx) && tgtIdx !== dragSourceIdx) {
        performReorder(dragSourceIdx, tgtIdx, touch.clientY, cell);
      }
    } else if (target?.closest('.group-grid')) {
      const insertIdx = findInsertionIndex(touch.clientX, touch.clientY);
      if (insertIdx >= 0) {
        const [moved] = state.cells.splice(dragSourceIdx, 1);
        const adj = dragSourceIdx < insertIdx ? insertIdx - 1 : insertIdx;
        state.cells.splice(adj, 0, moved);
        saveGroupState();
        reRenderGrid();
      }
    }
    dropCleanup();
  }

  function handleTouchCancel() { if (dragSourceIdx >= 0) dropCleanup(); }

  // ── Preset drag & drop handlers ──

  function getPresetDropdown() {
    const dd = root.querySelector('.group-preset-dropdown');
    return dd && !dd.classList.contains('is-hidden') ? dd : null;
  }

  function handlePresetDragStart(e) {
    const handle = e.target.closest('.group-preset-handle');
    if (!handle) return;
    const item = handle.closest('.group-preset-item');
    if (!item) return;
    presetDragIndex = parseInt(item.getAttribute('data-preset-index'), 10);
    if (isNaN(presetDragIndex)) { presetDragIndex = -1; return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(presetDragIndex));
    item.classList.add('dragging');
    const clone = item.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.top = '-9999px';
    clone.style.left = '-9999px';
    clone.style.width = item.offsetWidth + 'px';
    clone.style.background = 'var(--bg-panel)';
    clone.style.border = '1px solid var(--accent-cyan)';
    clone.style.borderRadius = '8px';
    clone.style.opacity = '0.85';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, 20, 12);
    requestAnimationFrame(() => clone.remove());
  }

  function handlePresetDragOver(e) {
    const dd = getPresetDropdown();
    if (!dd || presetDragIndex < 0 || dragSourceIdx >= 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dd.querySelectorAll('.group-preset-item').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const item = e.target.closest('.group-preset-item');
    if (item) {
      const r = item.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (y < 0.5) item.classList.add('drop-before');
      else item.classList.add('drop-after');
    }
  }

  function handlePresetDragLeave(e) {
    const item = e.target.closest('.group-preset-item');
    if (item) {
      const rel = e.relatedTarget;
      if (rel && item.contains(rel)) return;
      item.classList.remove('drop-before', 'drop-after');
    }
  }

  function handlePresetDrop(e) {
    e.preventDefault();
    if (presetDragIndex < 0) { presetDropCleanup(); return; }
    const item = e.target.closest('.group-preset-item');
    if (item) {
      const tgtIdx = parseInt(item.getAttribute('data-preset-index'), 10);
      if (!isNaN(tgtIdx) && tgtIdx !== presetDragIndex) {
        reorderPreset(presetDragIndex, tgtIdx, item);
      }
    }
    presetDropCleanup();
  }

  function handlePresetDragEnd() { presetDropCleanup(); }

  function presetDropCleanup() {
    presetDragIndex = -1;
    if (presetDragPreview) { presetDragPreview.remove(); presetDragPreview = null; }
    root.querySelectorAll('.group-preset-item').forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
  }

  function handlePresetTouchStart(e) {
    const handle = e.target.closest('.group-preset-handle');
    if (!handle) return;
    const item = handle.closest('.group-preset-item');
    if (!item) return;
    presetDragIndex = parseInt(item.getAttribute('data-preset-index'), 10);
    if (isNaN(presetDragIndex)) { presetDragIndex = -1; return; }
    item.classList.add('dragging');
    presetDragPreview = item.cloneNode(true);
    presetDragPreview.style.position = 'fixed';
    presetDragPreview.style.pointerEvents = 'none';
    presetDragPreview.style.zIndex = '9999';
    presetDragPreview.style.width = item.offsetWidth + 'px';
    presetDragPreview.style.left = '-9999px';
    presetDragPreview.style.top = '-9999px';
    document.body.appendChild(presetDragPreview);
  }

  function handlePresetTouchMove(e) {
    if (presetDragIndex < 0) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (presetDragPreview) {
      presetDragPreview.style.left = (touch.clientX - presetDragPreview.offsetWidth / 2) + 'px';
      presetDragPreview.style.top = (touch.clientY - Math.min(presetDragPreview.offsetHeight, 40)) + 'px';
    }
    const dd = getPresetDropdown();
    if (!dd) return;
    dd.querySelectorAll('.group-preset-item').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const item = target?.closest('.group-preset-item');
    if (item) {
      const r = item.getBoundingClientRect();
      const y = (touch.clientY - r.top) / r.height;
      if (y < 0.5) item.classList.add('drop-before');
      else item.classList.add('drop-after');
    }
  }

  function handlePresetTouchEnd(e) {
    if (presetDragIndex < 0) return;
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const item = target?.closest('.group-preset-item');
    if (item) {
      const tgtIdx = parseInt(item.getAttribute('data-preset-index'), 10);
      if (!isNaN(tgtIdx) && tgtIdx !== presetDragIndex) {
        reorderPreset(presetDragIndex, tgtIdx, item);
      }
    }
    presetDropCleanup();
  }

  function handlePresetTouchCancel() { if (presetDragIndex >= 0) presetDropCleanup(); }

  function reorderPreset(srcIdx, tgtIdx, tgtItem) {
    const presets = loadPresets();
    const currentPreset = currentPresetIndex >= 0 && currentPresetIndex < presets.length ? presets[currentPresetIndex] : null;
    if (srcIdx < 0 || srcIdx >= presets.length || tgtIdx < 0 || tgtIdx >= presets.length) return;
    const [moved] = presets.splice(srcIdx, 1);
    const adj = srcIdx < tgtIdx ? tgtIdx - 1 : tgtIdx;
    let insertIdx = tgtItem.classList.contains('drop-after') ? adj + 1 : adj;
    presets.splice(insertIdx, 0, moved);
    savePresets(presets);
    if (currentPreset) currentPresetIndex = presets.indexOf(currentPreset);
    const dd = root.querySelector('.group-preset-dropdown');
    if (dd) setHTML(dd, renderPresetsHTML());
    updateCurrentPresetUI();
  }

  function performReorder(srcIdx, tgtIdx, clientY, tgtCell) {
    // Use the CSS class set during dragover, not a recalculation,
    // because clientY at drop time may differ from the last dragover.
    if (tgtCell.classList.contains('drop-before')) {
      const [moved] = state.cells.splice(srcIdx, 1);
      state.cells.splice(srcIdx < tgtIdx ? tgtIdx - 1 : tgtIdx, 0, moved);
    } else if (tgtCell.classList.contains('drop-after')) {
      const [moved] = state.cells.splice(srcIdx, 1);
      state.cells.splice((srcIdx < tgtIdx ? tgtIdx - 1 : tgtIdx) + 1, 0, moved);
    } else {
      [state.cells[srcIdx], state.cells[tgtIdx]] = [state.cells[tgtIdx], state.cells[srcIdx]];
    }
    saveGroupState();
    reRenderGrid();
  }

  // ── Drop line indicators ──

  function getDropLine() {
    let line = root.querySelector('.group-drop-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'group-drop-line is-hidden';
      root.querySelector('.group-grid')?.appendChild(line);
    }
    return line;
  }

  function showDropLine(insertIdx, clientX, clientY) {
    const line = getDropLine();
    line.classList.remove('is-hidden');
    const cells = root.querySelectorAll('.group-cell');
    const grid = root.querySelector('.group-grid');
    if (!grid || !cells.length) return;
    const gridR = grid.getBoundingClientRect();
    if (insertIdx <= 0 && clientX !== undefined && clientY !== undefined) {
      const r = cells[0].getBoundingClientRect();
      const firstRowBot = cells.length > 1
        ? Math.max(r.bottom, cells[1]?.getBoundingClientRect?.()?.bottom ?? r.bottom)
        : r.bottom;
      if (clientY >= r.top && clientY < firstRowBot && clientX < r.left) {
        // Left edge of first cell — vertical line
        const rightCell = cells.length > 1 && Math.abs(r.top - cells[1].getBoundingClientRect().top) < 10
          ? cells[1] : null;
        const tb = { top: r.top, bot: rightCell ? Math.max(r.bottom, rightCell.getBoundingClientRect().bottom) : r.bottom };
        line.style.left = (r.left - gridR.left - 1) + 'px';
        line.style.top = (tb.top - gridR.top) + 'px';
        line.style.width = '2px';
        line.style.height = (tb.bot - tb.top) + 'px';
      } else {
        // Above the first row — horizontal line
        line.style.top = (r.top - gridR.top - 1) + 'px';
        line.style.left = '4px';
        line.style.width = 'calc(100% - 8px)';
        line.style.height = '2px';
      }
    } else if (insertIdx <= 0) {
      const r = cells[0].getBoundingClientRect();
      line.style.top = (r.top - gridR.top - 1) + 'px';
      line.style.left = '4px';
      line.style.width = 'calc(100% - 8px)';
      line.style.height = '2px';
    } else if (insertIdx >= cells.length && clientX !== undefined && clientY !== undefined) {
      const last = cells[cells.length - 1];
      const lr = last.getBoundingClientRect();
      const lastRowBot = cells.length >= 2 && cells.length % 2 === 0
        ? Math.max(lr.bottom, cells[cells.length - 2].getBoundingClientRect().bottom)
        : lr.bottom;
      if (clientY >= lr.top && clientY < lastRowBot && clientX >= lr.right) {
        // Right edge of last cell — vertical line
        const prevCell = cells.length >= 2 && cells.length % 2 === 0 ? cells[cells.length - 2] : null;
        const tb = prevCell
          ? { top: Math.min(lr.top, prevCell.getBoundingClientRect().top), bot: Math.max(lr.bottom, prevCell.getBoundingClientRect().bottom) }
          : { top: lr.top, bot: lr.bottom };
        line.style.left = (lr.right - gridR.left - 1) + 'px';
        line.style.top = (tb.top - gridR.top) + 'px';
        line.style.width = '2px';
        line.style.height = (tb.bot - tb.top) + 'px';
      } else {
        // Below the last row — horizontal line
        line.style.top = (lr.bottom - gridR.top + 1) + 'px';
        line.style.left = '4px';
        line.style.width = 'calc(100% - 8px)';
        line.style.height = '2px';
      }
    } else if (insertIdx >= cells.length) {
      const r = cells[cells.length - 1].getBoundingClientRect();
      line.style.top = (r.bottom - gridR.top + 1) + 'px';
      line.style.left = '4px';
      line.style.width = 'calc(100% - 8px)';
      line.style.height = '2px';
    } else {
      const r = cells[insertIdx].getBoundingClientRect();
      const prevR = cells[insertIdx - 1].getBoundingClientRect();
      const sameRow = Math.abs(prevR.top - r.top) < 10;

      // Helper: compute row height bounds
      const rowBounds = (cellA, cellB) => {
        const a = cellA.getBoundingClientRect();
        const b = cellB ? cellB.getBoundingClientRect() : null;
        return {
          top: b ? Math.min(a.top, b.top) : a.top,
          bot: b ? Math.max(a.bottom, b.bottom) : a.bottom,
        };
      };

      if (sameRow) {
        // Vertical line between columns — span the row height
        const b = rowBounds(cells[insertIdx], cells[insertIdx - 1]);
        line.style.left = (r.left - gridR.left - 1) + 'px';
        line.style.top = (b.top - gridR.top) + 'px';
        line.style.width = '2px';
        line.style.height = (b.bot - b.top) + 'px';
      } else if (insertIdx % 2 === 0 && insertIdx > 0 && clientX !== undefined) {
        // Between rows — use mouse X to decide: right edge of prev row or left edge of this row
        const prevRowBot = insertIdx >= 2
          ? Math.max(prevR.bottom, cells[insertIdx - 2].getBoundingClientRect().bottom)
          : prevR.bottom;
        const prevRowRight = prevR.right;
        const thisRowLeft = r.left;
        const betweenRowY = (prevRowBot + r.top) / 2;

        if (clientY !== undefined && clientY < betweenRowY && clientX > prevRowRight) {
          // Right edge of previous row — vertical line at row end
          const pb = rowBounds(cells[insertIdx - 1], null);
          line.style.left = (prevR.right - gridR.left - 1) + 'px';
          line.style.top = (pb.top - gridR.top) + 'px';
          line.style.width = '2px';
          line.style.height = (pb.bot - pb.top) + 'px';
        } else {
          // Left edge of this row — vertical line at row start
          const rightCell = insertIdx + 1 < cells.length ? cells[insertIdx + 1] : null;
          const same = rightCell && Math.abs(r.top - rightCell.getBoundingClientRect().top) < 10;
          const tb = rowBounds(cells[insertIdx], same ? cells[insertIdx + 1] : null);
          line.style.left = (r.left - gridR.left - 1) + 'px';
          line.style.top = (tb.top - gridR.top) + 'px';
          line.style.width = '2px';
          line.style.height = (tb.bot - tb.top) + 'px';
        }
      } else {
        // Horizontal line between rows
        line.style.top = (r.top - gridR.top - 1) + 'px';
        line.style.left = '4px';
        line.style.width = 'calc(100% - 8px)';
        line.style.height = '2px';
      }
    }
  }

  function hideDropLine() {
    const line = root.querySelector('.group-drop-line');
    if (line) line.classList.add('is-hidden');
  }

  function findInsertionIndex(clientX, clientY) {
    const cells = root.querySelectorAll('.group-cell');
    if (!cells.length) return state.cells.length;
    // 2-column grid: cells at even indices start a new row
    for (let i = 0; i < cells.length; i += 2) {
      const lr = cells[i].getBoundingClientRect();
      const rr = i + 1 < cells.length ? cells[i + 1].getBoundingClientRect() : null;
      const rowTop = lr.top - 8;
      const rowBot = (rr ? Math.max(lr.bottom, rr.bottom) : lr.bottom) + 8;
      if (clientY >= rowTop && clientY < rowBot) {
        const gapL = lr.right;
        const gapR = rr ? rr.left : null;
        if (clientX < lr.left) return i;                                    // left edge
        if (gapR !== null && clientX >= gapL && clientX < gapR) return i + 1; // column gap
        if (clientX >= (rr ? rr.right : lr.right)) return i + (rr ? 2 : 1);   // right edge
        return i; // fallback — over the cell
      }
      if (clientY < rowTop) return i; // above this row
    }
    return state.cells.length;
  }

  async function selectAndRenderCell(idx, slug) {
    state.cells[idx] = { slug, level: null };
    saveGroupState();
    replaceCell(idx);
    await renderCellChart(idx);
  }

  function replaceCell(idx) {
    const old = root.querySelector(`.group-cell[data-cell-index="${idx}"]`);
    if (!old) return;
    const cell = state.cells[idx];
    if (cell && cell.slug) {
      const levelsHTML = renderCellLevelsHTML(cell, idx);
      old.outerHTML = `
        <div class="group-cell" data-cell-index="${idx}">
          ${renderCellHeaderHTML(cell, idx)}
          <div class="group-cell-chart-wrap" data-cell-index="${idx}"><div class="chart-wrap" style="position:relative"><p class="chart-meta" style="text-align:center;padding:40px">Loading...</p></div></div>
          ${levelsHTML}
        </div>
      `;
    } else {
      old.outerHTML = renderCellEmpty(idx);
    }
  }

  function reRenderGrid() {
    const grid = root.querySelector('.group-grid');
    if (!grid) return;
    grid.outerHTML = renderGridHTML();
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i].slug) renderCellChart(i);
    }
  }

  function reRenderAllCharts() {
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i].slug) renderCellChart(i);
    }
  }

  async function renderCellChart(idx) {
    const cell = state.cells[idx];
    if (!cell || !cell.slug) return;
    const cellEl = root.querySelector(`.group-cell[data-cell-index="${idx}"]`);
    if (!cellEl) return;
    const chartWrap = cellEl.querySelector('.group-cell-chart-wrap .chart-wrap');
    if (!chartWrap) return;

    try {
      if (!itemCache[cell.slug]) {
        itemCache[cell.slug] = normalizePublicItemData(await fetchJson(assetPath(`data/public/items/${encodeURIComponent(cell.slug)}.json`)));
      }
      const itemData = itemCache[cell.slug];
      const levels = itemData.data || {};
      const levelKeys = itemData.levels || ['0'];
      cell._levelKeys = levelKeys;

      if (!cell.level || !levelKeys.includes(cell.level)) {
        cell.level = levelKeys.includes('0') ? '0' : levelKeys[0];
      }
      const levelData = levels[cell.level] || {};

      const usesDaily = (WINDOW_CONFIG[groupWindow]?.hours || 0) >= (24 * 30);
      let series;
      if (usesDaily && ['30d', '60d', '90d', '120d'].includes(groupWindow)) {
        const ds = levelData.daily || [];
        const hs = levelData.hourly || [];
        if (ds.length > 0 && hs.length > 0) {
          const bucketMs = displayBucketMsForWindow(groupWindow);
          const now = Date.now();
          const todayStart = Math.floor(now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
          const lastBucketStart = Math.floor(todayStart / bucketMs) * bucketMs;
          const dailyBefore = ds.filter((p) => p?.timestamp && p.timestamp < lastBucketStart);
          const hourlyFrom = hs.filter((p) => p?.timestamp && p.timestamp >= lastBucketStart);
          if (hourlyFrom.length > 0) { series = [...dailyBefore, ...hourlyFrom]; }
          else { series = usesDaily ? (levelData.daily || []) : (levelData.hourly || []); }
        } else { series = usesDaily ? (levelData.daily || []) : (levelData.hourly || []); }
      } else { series = usesDaily ? (levelData.daily || []) : (levelData.hourly || []); }

      const windowed = windowPoints(series, groupWindow);
      const points = aggregateDisplaySeries(windowed, groupWindow);

      if (!points || points.length === 0) {
        setHTML(chartWrap, '<div class="empty-state">No data for this window.</div>');
        return;
      }

      // Update level pills
      let lvlsEl = cellEl.querySelector('.group-cell-levels');
      if (!lvlsEl && levelKeys.length > 1) {
        lvlsEl = document.createElement('div');
        lvlsEl.className = 'group-cell-levels';
        lvlsEl.setAttribute('data-cell-index', idx);
        cellEl.appendChild(lvlsEl);
      }
      if (lvlsEl) {
        setHTML(lvlsEl, levelKeys.map((lv) =>
          `<button class="pill ${lv === cell.level ? 'active' : ''}" data-level="${escapeHtml(lv)}" data-cell-index="${idx}">+${escapeHtml(lv)}</button>`
        ).join(''));
      }

      const chartData = buildChart(points, 960, 400, null, null, WINDOW_CONFIG[groupWindow], points);
      setHTML(chartWrap, chartData.html);

      const guideEl = document.createElement('div');
      guideEl.className = 'chart-guide group-cell-guide is-hidden';
      chartWrap.appendChild(guideEl);
      const hoverEl = document.createElement('div');
      hoverEl.className = 'chart-hover group-cell-hover is-hidden';
      chartWrap.appendChild(hoverEl);

      setupCellHover(chartWrap, chartData, points);
    } catch (err) {
      setHTML(chartWrap, `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`);
    }
  }

  function setupCellHover(chartWrap, chartData, points) {
    const hover = chartWrap.querySelector('.chart-hover');
    const guide = chartWrap.querySelector('.chart-guide');
    const svg = chartWrap.querySelector('svg');
    if (!hover || !guide || !svg || !points.length) return;

    const posData = chartData.pointPositions || [];
    const dataPoints = chartData.pointData || [];

    function hide() { hover.classList.add('is-hidden'); guide.classList.add('is-hidden'); }

    function show(clientX) {
      const bw = 220, bg = 12, bm = 10;
      const bounds = svg.getBoundingClientRect();
      const scaleX = bounds.width / 960;
      const rx = (clientX - bounds.left) / scaleX;
      let ci = 0, cd = Infinity;
      for (let i = 0; i < posData.length; i++) {
        const d = Math.abs(posData[i].x - rx);
        if (d < cd) { cd = d; ci = i; }
      }
      const pt = dataPoints[ci];
      if (!pt) { hide(); return; }
      const x = posData[ci].x * scaleX;
      guide.classList.remove('is-hidden');
      guide.style.left = `${x - 1}px`;
      hover.classList.remove('is-hidden');
      const sr = bounds.width - x;
      const hl = sr < bw + bg + bm ? Math.max(bm, x - bw - bg) : Math.min(x + bg, bounds.width - bw - bm);
      hover.style.left = `${hl}px`;
      hover.style.top = '16px';
      setHTML(hover, `
        <div class="chart-hover-date">${escapeHtml(pt.label)}</div>
        <div class="chart-hover-row"><span>Ask: </span><strong>${formatCurrency(pt.a)}</strong></div>
        <div class="chart-hover-row"><span>Bid: </span><strong>${formatCurrency(pt.b)}</strong></div>
        <div class="chart-hover-row"><span>Spread: </span><strong>${formatCurrency(pt.sp)}</strong></div>
        <div class="chart-hover-row"><span>Spread %: </span><strong>${formatPercent(pt.spPct)}</strong></div>
        <div class="chart-hover-row"><span>Volume: </span><strong>${formatNumber(pt.v)}</strong></div>
        <div class="chart-hover-row"><span>VWAP: </span><strong>${formatCurrency(pt.p)}</strong></div>
      `);
    }

    chartWrap.onmouseleave = hide;
    chartWrap.onmousemove = (ev) => show(ev.clientX);
  }
}

async function main() {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const fallback = img.getAttribute('data-fallback-src');
    if (fallback && !img.getAttribute('data-tried')) {
      img.setAttribute('data-tried', '1');
      img.src = fallback;
    } else {
      img.style.display = 'none';
    }
  }, true);

  const route = getRoute();
  try {
    if (route.type === 'item' && route.slug) {
      await renderItem(root, route.slug);
    } else if (route.type === 'trends') {
      await renderTrends(root);
    } else if (route.type === 'group') {
      await renderGroup(root);
    } else {
      await renderHome(root);
    }

    void registerServiceWorker();
  } catch (error) {
    renderShell(root, 'Market Observatory', `<section class="card"><div class="empty-state">Unable to load data: ${escapeHtml(error.message)}</div></section>`, '');
  }
}

function formatTrendCoin(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 100e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toLocaleString('en-US');
}

function formatTrendPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

const TREND_WINDOWS = ['12h', '24h', '3d', '7d', '14d', '30d'];
const TREND_WINDOW_LABELS = {
  '12h': '12 Hours',
  '24h': '24 Hours',
  '3d': '3 Days',
  '7d': '7 Days',
  '14d': '14 Days',
  '30d': '30 Days',
};

async function renderTrends(root) {
  const catalog = await loadCatalog();
  const iconFiles = catalog.iconFiles || {};
  const slugToName = {};
  for (const item of catalog.items || []) {
    slugToName[item.slug] = item.name;
  }
  const { categories, slugToCategory } = await loadCategories();

  const PANEL_LIMIT = 50;
  const savedTrends = loadTrendsFilters();
  const validCatIds = new Set(categories.map((c) => c.id));
  let selectedWindow = TREND_WINDOWS.includes(savedTrends.window) ? savedTrends.window : '24h';
  let items = [];
  let status = 'loading';
  let showAll = false;
  let selectedCategories = new Set((Array.isArray(savedTrends.categories) ? savedTrends.categories : []).filter((id) => validCatIds.has(id)));
  let showEnhanced = savedTrends.showEnhanced !== false;
  let favoritesOnly = savedTrends.favoritesOnly === true;
  const favoriteSet = new Set(loadFavorites());
  let search = '';
  const sortState = { field: 'pct', dir: -1 };

  function resolveIcon(slug) {
    const slugLower = slug.toLowerCase();
    const svgName = iconFiles[slugLower]?.svg || `${slugLower}.svg`;
    const pngName = iconFiles[slugLower]?.png || `${slugLower}.png`;
    return {
      svgUrl: assetPath(`assets/item_icons/${encodeURIComponent(svgName)}`),
      pngUrl: assetPath(`assets/item_icons/${encodeURIComponent(pngName)}`),
    };
  }

function buildRows() {
    const withData = [];
    for (const item of items) {
      if (!item.levels) continue;
      if (favoritesOnly) {
        if (!favoriteSet.has(String(item.slug).toLowerCase())) continue;
      } else if (selectedCategories.size > 0) {
        const catIdx = slugToCategory[item.slug];
        if (typeof catIdx !== 'number' || !selectedCategories.has(catIdx)) continue;
      }
      for (const [levelKey, windowMap] of Object.entries(item.levels)) {
        const level = parseInt(levelKey, 10);
        if (!showEnhanced && level > 0) continue;
        const entry = windowMap[selectedWindow];
        if (entry && typeof entry.pct === 'number' && Number.isFinite(entry.pct)) {
          withData.push({ item, entry: { ...entry, level, vol1d: windowMap.vol1d, vol7d: windowMap.vol7d } });
        }
      }
    }

    return withData;
  }

  function getSortValue(x, field) {
    const entry = x.entry;
    switch (field) {
      case 'name': return (x.item.name || slugToName[x.item.slug] || x.item.slug).toLowerCase();
      case 'price': return entry.price;
      case 'pct': return entry.pct;
      case 'vol1d': return entry.vol1d ? entry.vol1d.vol : null;
      case 'vol1dPct': return entry.vol1d ? entry.vol1d.pct : null;
      case 'vol7d': return entry.vol7d ? entry.vol7d.vol : null;
      case 'vol7dPct': return entry.vol7d ? entry.vol7d.pct : null;
      default: return null;
    }
  }

  function compareRows(a, b, field, dir) {
    const va = getSortValue(a, field);
    const vb = getSortValue(b, field);
    if (field === 'name') {
      return dir * String(va).localeCompare(String(vb));
    }
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return dir * (va - vb);
  }

function renderTable(list) {
    const sortedList = [...list].sort((a, b) => compareRows(a, b, sortState.field, sortState.dir));
    const query = search.trim().toLowerCase();
    const filtered = query
      ? sortedList.filter((x) => (x.item.name || slugToName[x.item.slug] || x.item.slug).toLowerCase().includes(query))
      : sortedList;
    const limited = showAll ? filtered : filtered.slice(0, PANEL_LIMIT);
    const rows = limited.map((x, i) => {
      const { item, entry } = x;
      const iconUrls = resolveIcon(item.slug);
      const pctClass = entry.pct >= 0 ? 'trend-gain' : 'trend-loss';
      const levelSuffix = entry.level > 0 ? ` <span class="trend-level">+${entry.level}</span>` : '';
      return `
        <tr>
          <td class="trend-num trend-rank">${i + 1}</td>
          <td class="trend-item-cell">
            <img class="trend-icon" src="${iconUrls.svgUrl}" alt="" data-fallback-src="${iconUrls.pngUrl}" />
            ${favoriteStarHtml(item.slug, favoriteSet.has(String(item.slug).toLowerCase()))}
            <a href="${itemLink(item.slug)}">${escapeHtml(item.name || slugToName[item.slug] || item.slug)}${levelSuffix}</a>
          </td>
          <td class="trend-num">${formatTrendCoin(entry.price)}</td>
          <td class="trend-num ${pctClass}">${formatTrendPct(entry.pct)}</td>
          ${renderVolValCell(entry.vol1d)}
          ${renderVolChangeCell(entry.vol1d)}
          ${renderVolValCell(entry.vol7d)}
          ${renderVolChangeCell(entry.vol7d)}
        </tr>
      `;
    }).join('');

    const body = rows
      ? rows
      : '<tr><td colspan="8" class="trend-empty">No movers found for the selected filters.</td></tr>';

    function renderVolValCell(vol) {
      if (!vol || typeof vol.vol !== 'number' || !Number.isFinite(vol.vol)) {
        return '<td class="trend-num">—</td>';
      }
      return `<td class="trend-num">${formatCompactNumber(vol.vol)}</td>`;
    }

    function renderVolChangeCell(vol) {
      if (!vol || typeof vol.pct !== 'number' || !Number.isFinite(vol.pct)) {
        return '<td class="trend-num">—</td>';
      }
      const cls = vol.pct >= 0 ? 'trend-gain' : 'trend-loss';
      return `<td class="trend-num"><span class="trend-vol-pct ${cls}">${formatTrendPct(vol.pct)}</span></td>`;
    }

    const sortArrow = (field) => (sortState.field === field ? (sortState.dir > 0 ? ' ▲' : ' ▼') : '');
    const sortTh = (field, label) => `
      <th class="trend-num trend-sort ${sortState.field === field ? 'active' : ''}" data-sort="${field}" title="Sort by ${label}">${label}${sortArrow(field)}</th>
    `;

    const moreBtn = filtered.length > PANEL_LIMIT
      ? `<button class="trend-more-btn">${showAll ? 'Show less' : `Show all (${filtered.length})`}</button>`
      : '';

    return `
      <section class="card trend-panel">
        <div class="trend-panel-header">
          <div>
            <h2>All Movers</h2>
            <p class="trend-subtitle">Sort by any column — click a header to toggle ascending / descending.</p>
          </div>
          ${moreBtn}
        </div>
        <div class="trend-table-wrap">
          <table class="trend-table">
            <colgroup>
              <col class="trend-col-rank" />
              <col class="trend-col-item" />
              <col class="trend-col-price" />
              <col class="trend-col-pct" />
              <col class="trend-col-vol1d" />
              <col class="trend-col-vol1dPct" />
              <col class="trend-col-vol7d" />
              <col class="trend-col-vol7dPct" />
            </colgroup>
            <thead>
              <tr>
                <th class="trend-num">#</th>
                <th><input class="trend-search" type="search" value="${escapeHtml(search)}" placeholder="Filter items..." autocomplete="off" aria-label="Filter items" /></th>
                ${sortTh('price', 'Price')}
                ${sortTh('pct', 'Change')}
                ${sortTh('vol1d', 'Vol 1d')}
                ${sortTh('vol1dPct', 'Δ 1d')}
                ${sortTh('vol7d', 'Vol 7d')}
                ${sortTh('vol7dPct', 'Δ 7d')}
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderTrendPage() {
    const backLink = `<nav class="group-nav outside-back trends-back-link">
      <a class="minimal-back-link" href="${SITE_BASE_PATH}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg> Home</a>
      <a class="minimal-back-link" href="${SITE_BASE_PATH}group">Group View</a>
    </nav>`;
    const logoHtml = `<img src="${assetPath('assets/logo.svg')}" alt="Logo" class="hero-logo-img" />`;

    if (status === 'error') {
      renderShell(
        root,
        'Market Trends',
        `${backLink}<div class="trend-loading">Unable to load trends data.</div>`,
        'Item price movers across different time frames',
        '',
        logoHtml
      );
      return;
    }

if (status === 'loading') {
      renderShell(
        root,
        'Market Trends',
        `${backLink}<div class="trend-loading">Loading trends data...</div>`,
        'Item price movers across different time frames',
        '',
        logoHtml
      );
      return;
    }

    if (status === 'stale') {
      renderShell(
        root,
        'Market Trends',
        `${backLink}<div class="trend-loading">Trends data is out of date. Please do a hard refresh (Ctrl+Shift+R) to load the latest data.</div>`,
        'Item price movers across different time frames',
        '',
        logoHtml
      );
      return;
    }

const windowButtons = TREND_WINDOWS
      .map((key) => `<button class="trend-window-pill ${key === selectedWindow ? 'active' : ''}" data-window="${key}">${key}</button>`)
      .join('');

    const catButtons = [
      `<button class="filter-pill ${selectedCategories.size === 0 && !favoritesOnly ? 'active' : ''}" data-cat="all">All</button>`,
      `<button class="filter-pill ${favoritesOnly ? 'active' : ''}" data-cat="fav">Favorites</button>`,
      ...categories.map((c) => `<button class="filter-pill ${selectedCategories.has(c.id) ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.label)}</button>`),
    ].join('');

    const enhancedToggle = `
      <label class="trend-switch">
        <input type="checkbox" id="trend-enhanced-toggle" ${showEnhanced ? 'checked' : ''} />
        <span class="trend-switch-track" aria-hidden="true"></span>
        <span class="trend-switch-label">Enhanced Items</span>
      </label>`;

    const rows = buildRows();
    const windowLabel = TREND_WINDOW_LABELS[selectedWindow] || selectedWindow;

    saveTrendsFilters(selectedWindow, Array.from(selectedCategories), showEnhanced, favoritesOnly);

    renderShell(
      root,
      'Market Trends',
      `
        ${backLink}
        <div class="trends-controls">
          <label class="trend-label">Time Frame</label>
          <div class="button-row" id="trend-window-buttons">${windowButtons}</div>
        </div>
        <div class="category-filters" id="trend-category-filters">${catButtons}</div>
        <div class="trends-enhanced-row">${enhancedToggle}</div>
        ${renderTable(rows)}
      `,
      `Item price movers over the last ${windowLabel}`,
      '',
      logoHtml
    );
  }

async function loadTrends() {
    try {
      const data = await fetchJson(assetPath('data/public/trends.json'));
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const hasLevels = rawItems.some((i) => i && i.levels);
      if (!hasLevels) {
        status = 'stale';
      } else {
        items = rawItems.filter((i) => i && i.levels);
        status = 'ready';
      }
    } catch (error) {
      status = 'error';
    }
    renderTrendPage();
  }

  await loadTrends();

  root.addEventListener('click', (event) => {
    const windowPill = event.target.closest('.trend-window-pill');
    if (windowPill) {
      const newWindow = windowPill.dataset.window;
      if (newWindow && newWindow !== selectedWindow) {
        selectedWindow = newWindow;
        renderTrendPage();
      }
      return;
    }

if (event.target.closest('.trend-more-btn')) {
      showAll = !showAll;
      renderTrendPage();
    }

    const sortTh = event.target.closest('th.trend-sort');
    if (sortTh) {
      const field = sortTh.dataset.sort;
      if (sortState.field === field) {
        sortState.dir = -sortState.dir;
      } else {
        sortState.field = field;
        sortState.dir = -1;
      }
      renderTrendPage();
      return;
    }

    const catPill = event.target.closest('.filter-pill[data-cat]');
    if (catPill) {
      const cat = catPill.dataset.cat;
      if (cat === 'all') {
        selectedCategories.clear();
        favoritesOnly = false;
      } else if (cat === 'fav') {
        favoritesOnly = !favoritesOnly;
        if (favoritesOnly) selectedCategories.clear();
      } else {
        if (favoritesOnly) favoritesOnly = false;
        const catIdx = Number(cat);
        if (selectedCategories.has(catIdx)) {
          selectedCategories.delete(catIdx);
        } else {
          selectedCategories.add(catIdx);
        }
      }
      renderTrendPage();
    }

    const star = event.target.closest('.favorite-star');
    if (star) {
      event.preventDefault();
      event.stopPropagation();
      const slug = String(star.dataset.favSlug).toLowerCase();
      const isFavorite = toggleFavorite(slug);
      if (isFavorite) favoriteSet.add(slug);
      else favoriteSet.delete(slug);
      renderTrendPage();
    }
  });

  root.addEventListener('change', (event) => {
    if (event.target.id === 'trend-enhanced-toggle') {
      showEnhanced = event.target.checked;
      renderTrendPage();
    }
  });

  root.addEventListener('input', (event) => {
    if (!event.target.classList.contains('trend-search')) return;

    search = event.target.value;
    renderTrendPage();

    const input = root.querySelector('.trend-search');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}
main();
