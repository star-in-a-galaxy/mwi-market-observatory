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

function buildChart(points, width = 960, height = 360, fixedMinValue = null, fixedMaxValue = null, smoothLines = false, windowConfig = null, fullSeries = null) {
  const errorReturn = (msg) => ({
    html: `<div class="empty-state">${msg}</div>`,
    pointPositions: [],
    padding: { top: 20, right: 20, bottom: 34, left: 96 },
    innerWidth: 864,
  });

  if (!points.length) {
    return errorReturn('No chart data is available for this selection yet.');
  }

  const yValues = points.flatMap((point) => [point.ask, point.bid]).filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (!yValues.length) {
    return errorReturn('No usable ask or bid values are available for this selection yet.');
  }

  // Use fixed min/max if provided (for consistent scaling across time windows),
  // otherwise compute from current points
  const maxValue = fixedMaxValue !== null ? fixedMaxValue : Math.max(...yValues);
  const minValue = fixedMinValue !== null ? fixedMinValue : Math.min(...yValues);
  const maxLabelLength = formatNumber(Math.max(Math.abs(maxValue), Math.abs(minValue))).length;
  const padding = { top: 20, right: 20, bottom: 34, left: Math.max(96, maxLabelLength * 10 + 18) };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const getYAxisTickStep = (value) => {
    const safeValue = Math.max(1, Math.abs(value));
    const magnitude = Math.floor(Math.log10(safeValue));
    return Math.pow(10, Math.max(0, magnitude - 1));
  };

  // Snap the visible chart bounds to whole tick steps and keep one extra
  // tick step of leeway above and below the actual range.
  const tickStep = getYAxisTickStep(Math.max(Math.abs(maxValue), Math.abs(minValue)));
  const paddedMin = Math.floor(minValue / tickStep) * tickStep - tickStep;
  const paddedMax = Math.ceil(maxValue / tickStep) * tickStep + tickStep;
  const span = paddedMax - paddedMin;

  // Calculate X-scale based on actual time if window config is provided
  let scaleX;
  if (windowConfig && fullSeries && fullSeries.length > 0) {
    // Use time-based scaling with right-bound alignment
    const windowHours = windowConfig.hours;
    const windowMs = windowHours * 60 * 60 * 1000; // Convert hours to milliseconds
    
    // Get latest timestamp from full series (right edge of chart)
    const timestamps = fullSeries
      .map((p) => p.timestamp)
      .filter((ts) => typeof ts === 'number' && ts > 0);
    
    if (timestamps.length > 0) {
      const latestTimestamp = Math.max(...timestamps);
      const windowStart = latestTimestamp - windowMs; // Left edge is always window_start
      
      // Scale each point by its position within the selected time window
      scaleX = (point, index) => {
        if (!point || typeof point.timestamp !== 'number') return padding.left;
        const timeOffset = point.timestamp - windowStart;
        const position = (timeOffset / windowMs) * innerWidth;
        return padding.left + position;
      };
    } else {
      // Fallback to index-based if no timestamps
      scaleX = (_, index) => padding.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    }
  } else {
    // Original index-based scaling
    scaleX = (_, index) => padding.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  }

  const scaleY = (value) => padding.top + (1 - (value - paddedMin) / span) * innerHeight;

  const pointPositions = points.map((point, index) => ({
    index,
    x: typeof scaleX === 'function' && scaleX.length === 2 ? scaleX(point, index) : scaleX(index),
    askY: typeof point.ask === 'number' && point.ask > 0 ? scaleY(point.ask) : null,
    bidY: typeof point.bid === 'number' && point.bid > 0 ? scaleY(point.bid) : null,
  }));

  const toPath = (accessor) => {
    if (smoothLines && points.length > 1) {
      // Build smooth curve using cardinal spline with optimal tension for flowing curves
      let pathStr = '';
      const validIndices = [];
      
      // Find all valid (non-null) data points
      for (let i = 0; i < points.length; i++) {
        if (accessor(points[i]) != null) {
          validIndices.push(i);
        }
      }
      
      if (validIndices.length === 0) return '';
      if (validIndices.length === 1) {
        const idx = validIndices[0];
        const pos = pointPositions[idx];
        const y = scaleY(accessor(points[idx]));
        return `M ${pos.x.toFixed(1)} ${y.toFixed(1)}`;
      }
      
      // Start from first valid point
      let firstIdx = validIndices[0];
      let firstPos = pointPositions[firstIdx];
      pathStr += `M ${firstPos.x.toFixed(1)} ${scaleY(accessor(points[firstIdx])).toFixed(1)}`;
      
      // Create smooth segments - use higher tension for very smooth, flowing curves
      for (let i = 1; i < validIndices.length; i++) {
        const prevIdx = validIndices[i - 1];
        const currIdx = validIndices[i];
        const nextIdx = i + 1 < validIndices.length ? validIndices[i + 1] : currIdx;
        const prevPrevIdx = i - 2 >= 0 ? validIndices[i - 2] : prevIdx;
        
        const xPrev = pointPositions[prevIdx].x;
        const yPrev = scaleY(accessor(points[prevIdx]));
        const xCurr = pointPositions[currIdx].x;
        const yCurr = scaleY(accessor(points[currIdx]));
        const xNext = pointPositions[nextIdx].x;
        const yNext = scaleY(accessor(points[nextIdx]));
        const xPrevPrev = pointPositions[prevPrevIdx].x;
        const yPrevPrev = scaleY(accessor(points[prevPrevIdx]));
        
        // Catmull-Rom spline with low tension for gentle, smooth curves
        const t = 0.15;
        const cp1x = xPrev + (xNext - xPrevPrev) * t;
        const cp1y = yPrev + (yNext - yPrevPrev) * t;
        const cp2x = xCurr - (xNext - xPrev) * t;
        const cp2y = yCurr - (yNext - yPrev) * t;
        
        pathStr += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${xCurr.toFixed(1)} ${yCurr.toFixed(1)}`;
      }
      return pathStr;
    } else {
      // Straight line (original logic)
      return points
        .map((point, index) => accessor(point) != null
          ? `${index === 0 ? 'M' : 'L'} ${pointPositions[index].x.toFixed(1)} ${scaleY(accessor(point)).toFixed(1)}`
          : '')
        .join(' ');
    }
  };

  const toAreaPath = (accessor) => {
    const validIndices = [];
    
    for (let i = 0; i < points.length; i++) {
      if (accessor(points[i]) != null) {
        validIndices.push(i);
      }
    }
    
    if (validIndices.length === 0) return '';
    
    let pathStr = '';
    let firstIdx = validIndices[0];
    let firstPos = pointPositions[firstIdx];
    pathStr += `M ${firstPos.x.toFixed(1)} ${scaleY(accessor(points[firstIdx])).toFixed(1)}`;
    
    if (smoothLines && points.length > 1) {
      // Same smooth curve logic for area
      for (let i = 1; i < validIndices.length; i++) {
        const prevIdx = validIndices[i - 1];
        const currIdx = validIndices[i];
        const nextIdx = i + 1 < validIndices.length ? validIndices[i + 1] : currIdx;
        const prevPrevIdx = i - 2 >= 0 ? validIndices[i - 2] : prevIdx;
        
        const xPrev = pointPositions[prevIdx].x;
        const yPrev = scaleY(accessor(points[prevIdx]));
        const xCurr = pointPositions[currIdx].x;
        const yCurr = scaleY(accessor(points[currIdx]));
        const xNext = pointPositions[nextIdx].x;
        const yNext = scaleY(accessor(points[nextIdx]));
        const xPrevPrev = pointPositions[prevPrevIdx].x;
        const yPrevPrev = scaleY(accessor(points[prevPrevIdx]));
        
        const t = 0.15;
        const cp1x = xPrev + (xNext - xPrevPrev) * t;
        const cp1y = yPrev + (yNext - yPrevPrev) * t;
        const cp2x = xCurr - (xNext - xPrev) * t;
        const cp2y = yCurr - (yNext - yPrev) * t;
        
        pathStr += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${xCurr.toFixed(1)} ${yCurr.toFixed(1)}`;
      }
    } else {
      // Straight lines for area
      for (let i = 1; i < validIndices.length; i++) {
        const idx = validIndices[i];
        const pos = pointPositions[idx];
        pathStr += ` L ${pos.x.toFixed(1)} ${scaleY(accessor(points[idx])).toFixed(1)}`;
      }
    }
    
    // Close the path at bottom
    const lastIdx = validIndices[validIndices.length - 1];
    const lastPos = pointPositions[lastIdx];
    const bottomY = padding.top + innerHeight;
    pathStr += ` L ${lastPos.x.toFixed(1)} ${bottomY.toFixed(1)}`;
    pathStr += ` L ${firstPos.x.toFixed(1)} ${bottomY.toFixed(1)} Z`;
    
    return pathStr;
  };

  const grid = [];
  const firstTick = Math.ceil(paddedMin / tickStep) * tickStep;
  const lastTick = Math.floor(paddedMax / tickStep) * tickStep;

  for (let tickValue = firstTick; tickValue <= lastTick; tickValue += tickStep) {
    const y = padding.top + (1 - (tickValue - paddedMin) / span) * innerHeight;
    grid.push(`
      <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" class="chart-grid" />
      <text x="${padding.left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-label chart-label-y">${formatNumber(Math.round(tickValue))}</text>
    `);
  }

  const xLabels = points.length > 6
    ? [0, Math.floor(points.length / 2), points.length - 1]
    : points.map((_, index) => index);
  const seen = new Set();
  let lastDateLabel = null;
  const xAxis = xLabels
    .filter((index) => !seen.has(index) && seen.add(index))
    .map((index) => {
      const point = points[index];
      const pos = pointPositions[index];
      
      // Extract date only (everything before the comma in "May 07, 11:34 PM")
      const fullLabel = point.label || point.t || '';
      const dateLabel = fullLabel.split(',')[0].trim(); // Get "May 07"
      
      // Only show label if date is different from previous
      if (dateLabel === lastDateLabel) {
        return ''; // Skip duplicate dates
      }
      lastDateLabel = dateLabel;
      
      return `
        <text x="${pos.x.toFixed(1)}" y="${height - 6}" text-anchor="middle" class="chart-label">${escapeHtml(dateLabel)}</text>
      `;
    })
    .filter(label => label !== '') // Remove empty strings
    .join('');

  const markers = pointPositions.map((point, index) => {
    const data = points[index];
    const askCircle = point.askY != null ? `<circle cx="${point.x.toFixed(1)}" cy="${point.askY.toFixed(1)}" r="2.8" class="chart-point chart-point-ask" />` : '';
    const bidCircle = point.bidY != null ? `<circle cx="${point.x.toFixed(1)}" cy="${point.bidY.toFixed(1)}" r="2.8" class="chart-point chart-point-bid" />` : '';
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
        ${markers}
        ${xAxis}
      </svg>
      <div id="chart-hover" class="chart-hover is-hidden" aria-live="polite"></div>
      <div id="chart-guide" class="chart-guide is-hidden"></div>
    </div>
  `,
    pointPositions,
    padding,
    innerWidth,
  };
}

function renderShell(root, title, content, subtitle = '', iconHtml = '') {
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

async function loadCatalog() {
  try {
    const catalog = await fetchJson(assetPath('data/public/index.json'));
    if (Array.isArray(catalog.items)) {
      return catalog;
    }
  } catch (error) {
    // Fallback handled below.
  }

  return { items: [] };
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
        const slugLower = item.slug.toLowerCase();
        const iconSvg = assetPath(`assets/item_icons/${slugLower}.svg`);
        const iconPng = assetPath(`assets/item_icons/${slugLower}.png`);
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
        <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-bottom:0.5rem;">
          <div id="grid-size-controls" class="grid-size-controls">
            <button class="grid-size-button" data-cols="6">6</button>
            <button class="grid-size-button active" data-cols="8">8</button>
            <button class="grid-size-button" data-cols="10">10</button>
          </div>
          <div id="category-filters" class="category-filters">${filtersHtml}</div>
        </div>
        <div id="item-list" class="item-grid"></div>
      </section>
    `,
    'Browse the market history of any item in the game'
  );

  const search = document.getElementById('item-search');
  const list = document.getElementById('item-list');
  
  if (!search || !list) {
    return;
  }

  let selectedCategory = 'all';
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
      Array.from(filtersContainer.querySelectorAll('button')).forEach((b) => b.classList.toggle('active', b === btn));
      selectedCategory = idx === 'all' ? 'all' : Number(idx);

      const query = search.value.trim().toLowerCase();
      filteredItems = sortedItems.filter((item) => {
        if (selectedCategory !== 'all') {
          const catIdx = typeof slugToCategory[item.slug] === 'number' ? slugToCategory[item.slug] : null;
          if (catIdx !== selectedCategory) return false;
        }
        const name = (item.name || slugToTitle(item.slug)).toLowerCase();
        return !query || name.includes(query) || item.slug.toLowerCase().includes(query);
      });

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

    renderFilteredItems();
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
  return points.slice(-config.hours);
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

  const levels = itemData?.levels || {};
  const levelKeys = Object.keys(levels).length ? Object.keys(levels) : (itemMeta?.levels || ['0']);
  let selectedLevel = levelKeys.includes('0') ? '0' : levelKeys[0];
  let selectedWindow = DEFAULT_WINDOW;
  let smoothLines = false;

  const renderLevelButtons = () => levelKeys
    .map((level) => `<button class="pill ${level === selectedLevel ? 'active' : ''}" data-level="${escapeHtml(level)}">+${escapeHtml(level)}</button>`)
    .join('');

  const renderWindowButtons = () => Object.keys(WINDOW_CONFIG)
    .map((key) => `<button class="pill ${key === selectedWindow ? 'active' : ''}" data-window="${escapeHtml(key)}">${escapeHtml(WINDOW_CONFIG[key].label)}</button>`)
    .join('');

  const currentPoints = () => {
    const levelData = levels[selectedLevel] || {};
    const series = levelData.hourly || [];
    return windowPoints(series, selectedWindow);
  };

  const getPointByIndex = (index) => currentPoints()[index] || null;

  // Compute the global min/max for the current level (across all time windows)
  // to keep the Y-axis consistent regardless of selected window
  const getGlobalRange = () => {
    const levelData = levels[selectedLevel] || {};
    const allPoints = levelData.hourly || [];
    const allYValues = allPoints.flatMap((point) => [point.ask, point.bid]).filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (!allYValues.length) {
      return { min: null, max: null };
    }
    return { min: Math.min(...allYValues), max: Math.max(...allYValues) };
  };

  const updateView = () => {
    const points = currentPoints();
    const globalRange = getGlobalRange();
    const chart = document.getElementById('price-chart');
    const stats = document.getElementById('item-stats');
    const latest = points[points.length - 1];
    const previous = points[points.length - 2];

    if (chart) {
      const levelData = levels[selectedLevel] || {};
      const fullSeries = levelData.hourly || [];
      const windowConfig = WINDOW_CONFIG[selectedWindow];
      const chartData = buildChart(points, 960, 360, globalRange.min, globalRange.max, smoothLines, windowConfig, fullSeries);
      chart.innerHTML = chartData.html;
      // Store for hover logic
      chart.dataset.pointPositions = JSON.stringify(chartData.pointPositions.map(p => ({ x: p.x })));
      chart.dataset.padding = JSON.stringify(chartData.padding);
      chart.dataset.innerWidth = chartData.innerWidth;
    }

    if (stats) {
      stats.innerHTML = latest
        ? `
          <div><span class="stat-label">Ask</span><strong>${formatNumber(latest.a)}</strong></div>
          <div><span class="stat-label">Bid</span><strong>${formatNumber(latest.b)}</strong></div>
          <div><span class="stat-label">Spread</span><strong>${formatNumber(latest.sp)}</strong></div>
          <div><span class="stat-label">Spread %</span><strong>${formatPercent(latest.spPct)}</strong></div>
        `
        : '<div class="empty-state">No points available for this selection.</div>';
    }

    const levelButtons = document.getElementById('level-buttons');
    if (levelButtons) {
      levelButtons.innerHTML = renderLevelButtons();
    }

    const windowButtons = document.getElementById('window-buttons');
    if (windowButtons) {
      windowButtons.innerHTML = renderWindowButtons();
    }

    const pointMeta = document.getElementById('point-meta');
    if (pointMeta) {
      pointMeta.textContent = points.length
        ? `${points.length} hourly points in ${calcWindowLabel(selectedWindow)}`
        : `No data available for ${calcWindowLabel(selectedWindow)}`;
    }

    const chartHover = document.getElementById('chart-hover');
    const chartGuide = document.getElementById('chart-guide');
    const chartWrap = document.querySelector('.chart-wrap');
    if (!chartHover || !chartGuide || !chartWrap || !points.length) {
      if (chartHover) {
        chartHover.classList.add('is-hidden');
      }
      if (chartGuide) {
        chartGuide.classList.add('is-hidden');
      }
      return;
    }

    const svg = chartWrap.querySelector('svg');
    if (!svg) {
      return;
    }

    const svgBounds = svg.getBoundingClientRect();
    const padding = { top: 20, right: 20, bottom: 34, left: Math.max(96, formatNumber(Math.max(...points.flatMap((point) => [point.ask, point.bid]).filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0))).length * 10 + 18) };
    const innerWidth = 960 - padding.left - padding.right;

    const hideHover = () => {
      chartHover.classList.add('is-hidden');
      chartGuide.classList.add('is-hidden');
    };

    const showHoverForClientX = (clientX) => {
      const relativeX = clientX - svgBounds.left;
      
      // Parse stored point positions
      const posData = chart.dataset.pointPositions ? JSON.parse(chart.dataset.pointPositions) : [];
      const paddingData = chart.dataset.padding ? JSON.parse(chart.dataset.padding) : { left: padding.left, right: 20, top: 20, bottom: 34 };
      
      // Find the closest point by X position
      let closestIndex = 0;
      let closestDistance = posData.length > 0 ? Math.abs(posData[0].x - relativeX) : Infinity;
      
      for (let i = 1; i < posData.length; i++) {
        const distance = Math.abs(posData[i].x - relativeX);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = i;
        }
      }
      
      const index = closestIndex;
      const point = getPointByIndex(index);
      if (!point || !posData[index]) {
        hideHover();
        return;
      }

      const x = posData[index].x;
      const ask = point.a;
      const bid = point.b;
      const spread = point.sp;
      const spreadPct = point.spPct;
      const effectiveSell = typeof ask === 'number' ? ask * 0.98 : null;
      const effectiveBuy = typeof bid === 'number' ? bid * 0.98 : null;

      chartGuide.classList.remove('is-hidden');
      chartGuide.style.left = `${x}px`;

      chartHover.classList.remove('is-hidden');
      chartHover.style.left = `${Math.min(Math.max(12, x + 16), Math.max(12, svgBounds.width - 260))}px`;
      chartHover.style.top = `${Math.max(12, Math.min(svgBounds.height - 180, 16))}px`;
      chartHover.innerHTML = `
        <div class="chart-hover-date">${escapeHtml(point.label || point.t)}</div>
        <div class="chart-hover-row"><span>Ask</span><strong>${formatCurrency(ask)}</strong></div>
        <div class="chart-hover-row"><span>Bid</span><strong>${formatCurrency(bid)}</strong></div>
        <div class="chart-hover-row"><span>Spread</span><strong>${formatCurrency(spread)}</strong></div>
        <div class="chart-hover-row"><span>Spread %</span><strong>${formatPercent(spreadPct)}</strong></div>
        <div class="chart-hover-row"><span>Effective sell</span><strong>${formatCurrency(effectiveSell)}</strong></div>
        <div class="chart-hover-row"><span>Effective buy</span><strong>${formatCurrency(effectiveBuy)}</strong></div>
      `;
    };

    chartWrap.onmouseleave = hideHover;
    chartWrap.onmousemove = (event) => showHoverForClientX(event.clientX);
    chartWrap.onmouseenter = (event) => showHoverForClientX(event.clientX);
  };

  const pageContent = `
    <section class="card item-page">
      <div class="item-header">
        <div>
          <a class="back-link" href="${SITE_BASE_PATH}">All items</a>
          <h2>${escapeHtml(itemName)}</h2>
          <p class="item-slug">/${escapeHtml(slug)}</p>
        </div>
        <div class="controls">
          <div>
            <p class="control-label">Enhancement</p>
            <div id="level-buttons" class="button-row">${renderLevelButtons()}</div>
          </div>
          <div>
            <p class="control-label">Range</p>
            <div id="window-buttons" class="button-row">${renderWindowButtons()}</div>
          </div>
        </div>
      </div>

      <div class="chart-shell">
        <div id="price-chart">${(() => {
          const globalRange = getGlobalRange();
          const levelData = levels[selectedLevel] || {};
          const fullSeries = levelData.hourly || [];
          const windowConfig = WINDOW_CONFIG[selectedWindow];
          const chartData = buildChart(currentPoints(), 960, 360, globalRange.min, globalRange.max, smoothLines, windowConfig, fullSeries);
          return chartData.html;
        })()}</div>
        <p id="point-meta" class="chart-meta"></p>
        <div class="toggle-smooth-lines">
          <label class="toggle-label">Smooth lines</label>
          <div id="toggle-smooth" class="toggle-switch"></div>
        </div>
      </div>

      <div id="item-stats" class="stats-grid"></div>
    </section>
  `;

  const slugLower = slug.toLowerCase();
  const iconUrlSvg = assetPath(`assets/item_icons/${encodeURIComponent(slugLower)}.svg`);
  const iconUrlPng = assetPath(`assets/item_icons/${encodeURIComponent(slugLower)}.png`);
  const iconHtml = `<img class="item-page-icon" src="${iconUrlSvg}" alt="${escapeHtml(itemName)}" onerror="if(!this._tried){this._tried=true;this.src='${iconUrlPng}'}else{this.style.display='none'}" />`;
  renderShell(root, itemName, pageContent, 'Hourly price graph with level and range controls.', iconHtml);
  updateView();

  const rootElement = document.getElementById('app');
  if (!rootElement) {
    return;
  }

  rootElement.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const level = target.getAttribute('data-level');
    if (level) {
      selectedLevel = level;
      updateView();
      return;
    }

    const windowKey = target.getAttribute('data-window');
    if (windowKey) {
      selectedWindow = windowKey;
      updateView();
    }

    if (target.id === 'toggle-smooth') {
      smoothLines = !smoothLines;
      target.classList.toggle('active', smoothLines);
      updateView();
    }
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
  } catch (error) {
    renderShell(root, 'Market Observatory', `<section class="card"><div class="empty-state">Unable to load data: ${escapeHtml(error.message)}</div></section>`, '');
  }
}

main();
