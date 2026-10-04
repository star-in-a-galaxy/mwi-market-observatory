// ==UserScript==
// @name         MWI Market Observatory
// @name:zh-CN   MWI 市场观察站
// @namespace    mwi-market-observatory
// @version      0.1.4
// @description  Show market price charts from the MWI Market Observatory in the marketplace and in item context menus.
// @description:zh-CN 在市场及物品右键菜单中显示 MWI 市场观察站的价格图表。
// @icon         https://star-in-a-galaxy.github.io/mwi-market-observatory/assets/logo.svg
// @author       star-in-a-galaxy
// @license      CC-BY-NC-SA-4.0
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      star-in-a-galaxy.github.io
// @run-at       document-start
// @updateURL    https://update.greasyfork.org/scripts/593813/MWI%20Market%20Observatory.meta.js
// @downloadURL  https://update.greasyfork.org/scripts/593813/MWI%20Market%20Observatory.user.js
// ==/UserScript==

/*
  MWI Market Chart (Market Observatory)

  Pulls item bundles from the MWI Market Observatory GitHub Pages site
  (the observatory's deployed data, rebuilt from its data branch) and
  renders an item price chart like the one on the observatory site:

    https://star-in-a-galaxy.github.io/mwi-market-observatory/

  Features:
  ┌───────────────────────────────────────────────────────────────────────┐
  │  - Auto-opens the chart modal when an item is selected in the         │
  │    marketplace.                                                       │
  │  - Injects a "Market Chart" button into the item context menu.        │
  │  - Draggable modal with enhancement-level + window selectors,         │
  │    stats row, and a hoverable ask/bid/vwap chart.                     │
  │  - Data is cached in memory only (no persistent storage). Polls       │
  │    the currently open item's bundle every POLL_INTERVAL_MS and        │
  │    on manual refresh.                                                 │
  └───────────────────────────────────────────────────────────────────────┘

  中文（MWI 市场观察站）
  功能：
  1. 在市场中选择物品时自动打开价格图表窗口。
  2. 在物品右键菜单中注入「📈 市场图表」按钮。
  3. 可拖拽、可调整大小的弹窗，支持强化等级与时间范围选择、统计数据行
     以及可悬停的 买价/卖价/VWAP 图表。
  4. 数据仅缓存在内存中（不占用持久存储）；每 10 分钟自动刷新当前物品，
     也可点击手动刷新按钮。

  Disclaimer / 免责声明:
  This is an unofficial, community-made tool. Not affiliated with or endorsed by the game.
  Data is provided as-is and may be delayed or inaccurate. Use at your own risk.
  这是一个非官方社区制作工具，与游戏无关，也不受游戏官方认可。数据按原样提供，
  可能延迟或不准确，请自行承担使用风险。
*/

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════════
  const API_BASE = 'https://star-in-a-galaxy.github.io/mwi-market-observatory';
  const DATA_BASE = `${API_BASE}/data/public`;
  const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  const CHART_WIDTH = 960;
  const CHART_HEIGHT = 400;
  const TREND_THRESHOLD = 0.05; // only ~0 counts as "no change"
  const MILD_TREND_THRESHOLD = 0.5; // below this, show the change in yellow

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

  const COLORS = {
    bgDark: '#0f1419',
    textMuted: '#8b95a5',
    accentCyan: '#00d9ff',
    accentPurple: '#c77dff',
    lineAsk: '#00d9ff',
    lineBid: '#c77dff',
    strokeBlue: 'rgba(0, 217, 255, 0.2)',
  };

  // ═══════════════════════════════════════════════════════════════════
  // STYLES
  // ═══════════════════════════════════════════════════════════════════
  GM_addStyle(`
    #mwi-mo-modal {
      position: fixed;
      z-index: 2147483000;
      width: 760px;
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
      overflow: hidden;
      display: none;
      flex-direction: column;
      background: #151a24;
      border: 1px solid ${COLORS.strokeBlue};
      border-radius: 14px;
      box-shadow: 0 18px 50px rgba(0,0,0,0.7);
      color: #e8ecf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.4;
    }
    #mwi-mo-modal.mwi-mo-open { display: flex; }

    .mwi-mo-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
    }

    .mwi-mo-resize {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      z-index: 5;
      user-select: none;
    }
    .mwi-mo-resize::after {
      content: '';
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 10px;
      height: 10px;
      border-right: 2px solid rgba(255,255,255,0.4);
      border-bottom: 2px solid rgba(255,255,255,0.4);
    }
    .mwi-mo-resize:hover::after { border-color: ${COLORS.accentCyan}; }

    .mwi-mo-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.04);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      cursor: move;
      user-select: none;
      flex-shrink: 0;
      position: relative;
    }
    .mwi-mo-item-icon { width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
    .mwi-mo-title { font-weight: 700; font-size: 15px; }
    .mwi-mo-title .mwi-mo-lvl { color: ${COLORS.textMuted}; font-weight: 600; }
    .mwi-mo-header-actions { display: flex; gap: 6px; flex-shrink: 0; margin-left: auto; }

    .mwi-mo-title { cursor: pointer; }
    .mwi-mo-title:hover { color: ${COLORS.accentCyan}; }
    .mwi-mo-search {
      flex: 1;
      min-width: 0;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      color: #e8ecf3;
      font-size: 13px;
      font-family: inherit;
      padding: 4px 8px;
      outline: none;
      user-select: text;
    }
    .mwi-mo-search-results {
      position: absolute;
      top: 100%;
      left: 8px;
      right: 8px;
      margin-top: 4px;
      max-height: 260px;
      overflow-y: auto;
      background: ${COLORS.bgDark};
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      z-index: 20;
    }
    .mwi-mo-search-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      background: none;
      border: none;
      color: #e8ecf3;
      font-size: 13px;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
    }
    .mwi-mo-search-item:hover { background: rgba(255,255,255,0.08); }
    .mwi-mo-search-item img { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
    .mwi-mo-search-empty { padding: 8px; color: ${COLORS.textMuted}; font-size: 12px; }
    .mwi-mo-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.14);
      color: #e8ecf3;
      border-radius: 8px;
      width: 30px;
      height: 30px;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      font-family: inherit;
    }
    .mwi-mo-btn:hover { background: rgba(0,217,255,0.15); border-color: ${COLORS.accentCyan}; }

    .mwi-mo-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    .mwi-mo-pills { display: flex; gap: 5px; flex-wrap: wrap; }
    .mwi-mo-pill {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.12);
      color: #cdd6e4;
      border-radius: 999px;
      padding: 4px 11px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    .mwi-mo-pill:hover { border-color: ${COLORS.accentCyan}; color: #fff; }
    .mwi-mo-pill.mwi-mo-active {
      background: linear-gradient(135deg, #7c3aed, #6d28d9);
      border-color: transparent;
      color: #fff;
    }

    .mwi-mo-switch { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; cursor: pointer; user-select: none; font-size: 11px; color: ${COLORS.textMuted}; }
    .mwi-mo-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
    .mwi-mo-switch-slider { position: relative; width: 30px; height: 16px; border-radius: 999px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); transition: background 0.2s ease; }
    .mwi-mo-switch-slider::after { content: ''; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; transition: transform 0.2s ease; }
    .mwi-mo-switch input:checked + .mwi-mo-switch-slider { background: ${COLORS.accentCyan}; border-color: ${COLORS.accentCyan}; }
    .mwi-mo-switch input:checked + .mwi-mo-switch-slider::after { transform: translateX(14px); }
    .mwi-mo-switch-label { transition: opacity 0.2s ease; }
    .mwi-mo-switch:has(input:checked) .mwi-mo-switch-label.left { opacity: 0.45; }
    .mwi-mo-switch:has(input:not(:checked)) .mwi-mo-switch-label.right { opacity: 0.45; }

    .mwi-mo-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    .mwi-mo-stat { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 6px 8px; text-align: center; }
    .mwi-mo-stat-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: ${COLORS.textMuted}; }
    .mwi-mo-stat-value { display: block; font-weight: 700; font-variant-numeric: tabular-nums; }

    .mwi-mo-chart { padding: 8px 10px 4px; }

    .mwi-mo-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px 9px;
      color: ${COLORS.textMuted};
      font-size: 11px;
      flex-shrink: 0;
    }
    .mwi-mo-brand { display: inline-flex; align-items: center; gap: 5px; }
    .mwi-mo-link { color: ${COLORS.accentCyan}; text-decoration: none; }
    .mwi-mo-link:hover { text-decoration: underline; }
    .mwi-mo-error { color: #ff8080; padding: 14px; text-align: center; }

    .mwi-mo-auto {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      color: ${COLORS.textMuted};
      white-space: nowrap;
    }
    .mwi-mo-auto input { accent-color: #7c3aed; cursor: pointer; margin: 0; }

    .mwi-mo-footer-settings { display: inline-flex; align-items: center; gap: 12px; }

    .mwi-mo-mp-strip {
      display: block;
      width: 100%;
      margin: 6px 0;
      cursor: pointer;
      box-sizing: border-box;
    }
    .mwi-mo-mp-strip .mwi-mo-stats { padding: 0; border-bottom: none; }
    .mwi-mo-mp-strip:hover .mwi-mo-stat { border-color: ${COLORS.accentCyan}; }
    .mwi-mo-strip-bar { display: flex; align-items: center; justify-content: flex-start; gap: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: ${COLORS.textMuted}; padding: 2px 0 4px; }
    .mwi-mo-strip-toggle {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      color: ${COLORS.textMuted};
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      padding: 3px 9px;
      font-family: inherit;
    }
    .mwi-mo-strip-toggle:hover { color: ${COLORS.accentCyan}; border-color: ${COLORS.accentCyan}; }
    .mwi-mo-stat-trend { display: block; font-size: 10px; font-weight: 600; margin-top: 1px; }
    .mwi-mo-trend-up { color: #22c55e; }
    .mwi-mo-trend-down { color: #ef4444; }
    .mwi-mo-trend-flat { color: ${COLORS.textMuted}; }
    .mwi-mo-trend-mild { color: #e6c84d; }
    .mwi-mo-trend-arrow { font-weight: 700; font-size: 1.2em; }
    .mwi-mo-insufficient { font-size: 9px; color: ${COLORS.textMuted}; white-space: nowrap; }

    /* Context-menu injected button */
    .mwi-mo-menu-btn {
      width: 100%;
      margin-top: 6px;
    }

    /* Chart (scoped to the modal so it can't clash with the game) */
    #mwi-mo-modal .chart-wrap { position: relative; width: 100%; }
    #mwi-mo-modal .chart { width: 100%; height: auto; display: block; }
    #mwi-mo-modal .chart-grid { stroke: rgba(255, 255, 255, 0.05); stroke-width: 1; }
    #mwi-mo-modal .chart-label { fill: ${COLORS.textMuted}; font-size: 11px; }
    #mwi-mo-modal .chart-line { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    #mwi-mo-modal .chart-line-ask { stroke: ${COLORS.lineAsk}; filter: drop-shadow(0 0 8px rgba(0, 217, 255, 0.4)); }
    #mwi-mo-modal .chart-line-bid { stroke: ${COLORS.lineBid}; filter: drop-shadow(0 0 8px rgba(199, 125, 255, 0.4)); }
    #mwi-mo-modal .chart-line-vp { stroke: #e6c84d; opacity: 0.7; }
    #mwi-mo-modal .chart-area { mix-blend-mode: screen; }
    #mwi-mo-modal .chart-point { pointer-events: none; stroke: ${COLORS.bgDark}; stroke-width: 2; }
    #mwi-mo-modal .chart-point-ask { fill: ${COLORS.lineAsk}; }
    #mwi-mo-modal .chart-point-bid { fill: ${COLORS.lineBid}; }
    #mwi-mo-modal .chart-guide {
      position: absolute;
      top: 0; bottom: 0; width: 2px;
      background: linear-gradient(180deg, rgba(0, 217, 255, 0.5), transparent);
      pointer-events: none;
    }
    #mwi-mo-modal .chart-hover {
      position: absolute;
      min-width: 200px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid ${COLORS.strokeBlue};
      background: rgba(15, 20, 25, 0.98);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      z-index: 10;
      pointer-events: none;
    }
    #mwi-mo-modal .chart-hover-date { font-weight: 700; margin-bottom: 4px; font-size: 12px; }
    #mwi-mo-modal .chart-hover-row { display: flex; justify-content: space-between; gap: 14px; font-size: 12px; }
    #mwi-mo-modal .chart-hover-row span { color: ${COLORS.textMuted}; }
    #mwi-mo-modal .chart-hover-row:nth-of-type(2) strong { color: ${COLORS.accentCyan}; }
    #mwi-mo-modal .chart-hover-row:nth-of-type(3) strong { color: ${COLORS.accentPurple}; }
    #mwi-mo-modal .chart-hover-row:nth-of-type(6) strong { color: #2ecc71; }
    .is-hidden { display: none; }
  `);

  // ═══════════════════════════════════════════════════════════════════
  // NETWORK + CACHE (in-memory only, no persistent storage)
  // ═══════════════════════════════════════════════════════════════════
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload(res) {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error(`HTTP ${res.status} for ${url}`));
        },
        onerror() {
          reject(new Error(`Network error for ${url}`));
        },
      });
    });
  }

  async function fetchJson(url) {
    return JSON.parse(await gmFetch(url));
  }

  const indexCache = { data: null, fetchedAt: 0 };
  const INDEX_TTL_MS = 60 * 60 * 1000;

  async function getIndex(force) {
    if (!force && indexCache.data && Date.now() - indexCache.fetchedAt < INDEX_TTL_MS) {
      return indexCache.data;
    }
    const data = await fetchJson(`${DATA_BASE}/index.json`);
    indexCache.data = data;
    indexCache.fetchedAt = Date.now();
    return data;
  }

  function getDataAnchorTs(index) {
    const candidates = [index?.generatedAt, index?.source?.hourlyRange?.end, index?.source?.dailyRange?.end];
    for (const candidate of candidates) {
      const ts = typeof candidate === 'number' ? candidate : Date.parse(candidate);
      if (Number.isFinite(ts) && ts > 0) return ts;
    }
    return Date.now();
  }

  // Single-slot bundle cache: only the currently open item is held.
  const bundleCache = { slug: null, data: null, fetchedAt: 0 };

  async function getBundle(slug, force) {
    if (!force && bundleCache.slug === slug && bundleCache.data && Date.now() - bundleCache.fetchedAt < POLL_INTERVAL_MS) {
      return bundleCache.data;
    }
    const data = await fetchJson(`${DATA_BASE}/items/${encodeURIComponent(slug)}.json`);
    bundleCache.slug = slug;
    bundleCache.data = data;
    bundleCache.fetchedAt = Date.now();
    return data;
  }

  async function resolveItemIconUrl(slug) {
    try {
      const index = await getIndex();
      const entry = (index.iconFiles || {})[slug];
      const file = (entry && entry.svg) || `${slug}.svg`;
      return `${API_BASE}/assets/item_icons/${encodeURIComponent(file)}`;
    } catch (err) {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GAME DATA (isTradable via initClientData WebSocket message)
  // ═══════════════════════════════════════════════════════════════════
  const tradableMap = new Map(); // slug -> boolean

  function installWebSocketHook() {
    if (typeof unsafeWindow === 'undefined' || !unsafeWindow.WebSocket) return;
    const OriginalWebSocket = unsafeWindow.WebSocket;
    if (OriginalWebSocket.__mwiMoHooked) return;

    function HookedWebSocket(url, protocols) {
      const socket = new OriginalWebSocket(url, protocols);
      const urlStr = typeof url === 'string' ? url : String(url || '');
      if (urlStr.includes('api.milkywayidle.com/ws') || urlStr.includes('api-test.milkywayidle.com/ws')) {
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return;
          try {
            const msg = JSON.parse(event.data);
            const itemMap = msg && (msg.itemDetailMap || msg.item_detail_map);
            if (itemMap && typeof itemMap === 'object') {
              for (const [hrid, detail] of Object.entries(itemMap)) {
                const slug = String(hrid).replace(/^\/items\//, '');
                if (slug) tradableMap.set(slug, detail?.isTradable !== false);
              }
            }
          } catch (err) { /* ignore non-JSON socket messages */ }
        });
      }
      return socket;
    }
    HookedWebSocket.prototype = OriginalWebSocket.prototype;
    Object.setPrototypeOf(HookedWebSocket, OriginalWebSocket);
    HookedWebSocket.__mwiMoHooked = true;
    try {
      unsafeWindow.WebSocket = HookedWebSocket;
      if (typeof window !== 'undefined' && window !== unsafeWindow) window.WebSocket = HookedWebSocket;
    } catch (err) { /* ignore */ }
  }

  function isTradableForSlug(slug) {
    return tradableMap.get(slug) !== false; // unknown => assume tradable
  }

  installWebSocketHook();

  // ═══════════════════════════════════════════════════════════════════
  // IDENTITY: slug / name / level extraction
  // ═══════════════════════════════════════════════════════════════════
  async function nameToSlug(name) {
    if (!name) return null;
    const index = await getIndex();
    const items = Array.isArray(index.items) ? index.items : [];
    const target = name.trim();
    const targetLower = target.toLowerCase();

    // 1. exact match against the observatory's index
    const exact = items.find((it) => (it.name || '').toLowerCase() === targetLower);
    if (exact) return exact.slug;

    // 2. canonical match: strip apostrophes/punctuation so "Magician's Hat" -> "Magicians Hat" -> "magicians_hat"
    const canon = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const canonTarget = canon(target);
    const canonHit = items.find((it) => canon(it.name || '') === canonTarget);
    if (canonHit) return canonHit.slug;

    // 3. fallback: normalized slug (may 404 if the item isn't in the observatory)
    return canonTarget || null;
  }

  function slugFromSprite(root) {
    const use = root && root.querySelector('use[href*="#"], use[xlink\\:href*="#"]');
    const href = use ? (use.getAttribute('href') || use.getAttribute('xlink:href') || '') : '';
    const frag = href.split('#').pop();
    return frag || null;
  }

  function levelFromRoot(root) {
    const el = root && root.querySelector('[class*="Item_enhancementLevel"]');
    if (el) {
      const m = String(el.textContent || '').match(/\+?\d+/);
      if (m) return String(parseInt(m[0], 10));
    }
    return '0';
  }

  function nameFromRoot(root) {
    const el = root && (root.querySelector('[class*="Item_itemInfo"] [class*="Item_name"]') || root.querySelector('[class*="Item_name"]'));
    return el ? el.textContent.trim() : null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA NORMALIZATION (ported from the observatory's analyze site)
  // ═══════════════════════════════════════════════════════════════════
  function formatDayLabel(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
  }

  function formatHourLabel(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: 'numeric', hour12: true, timeZone: 'UTC' });
  }

  function normalizePublicSeriesPoint(point, kind, previousAsk, previousBid) {
    let timestamp = null, ask = null, bid = null, volume = null, price = null;
    let t = null, label = null;

    if (Array.isArray(point)) {
      [timestamp, ask, bid, volume, price] = point;
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        const iso = new Date(timestamp).toISOString();
        t = kind === 'daily' ? iso.split('T')[0] : iso;
        label = kind === 'daily' ? formatDayLabel(t) : formatHourLabel(iso);
      }
    } else if (point && typeof point === 'object') {
      timestamp = typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)
        ? point.timestamp
        : (typeof point.t === 'number' && Number.isFinite(point.t) ? point.t : Date.parse(point.t || point.label || ''));
      ask = typeof point.ask === 'number' ? point.ask : point.a;
      bid = typeof point.bid === 'number' ? point.bid : point.b;
      volume = typeof point.v === 'number' ? point.v : point.volume;
      price = typeof point.p === 'number' ? point.p : point.price;
      t = typeof point.t === 'string' ? point.t : null;
      label = typeof point.label === 'string' ? point.label : null;
    }

    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;

    ask = typeof ask === 'number' && Number.isFinite(ask) && ask > 0 ? ask : null;
    bid = typeof bid === 'number' && Number.isFinite(bid) && bid > 0 ? bid : null;
    volume = typeof volume === 'number' && Number.isFinite(volume) && volume > 0 ? volume : null;
    price = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;

    if (!t) {
      const iso = new Date(timestamp).toISOString();
      t = kind === 'daily' ? iso.split('T')[0] : iso;
    }
    if (!label) {
      label = kind === 'daily' ? formatDayLabel(t) : formatHourLabel(kind === 'daily' ? `${t}T00:00:00Z` : t);
    }

    const sp = ask != null && bid != null ? ask - bid : null;
    const spPct = sp != null && bid > 0 ? sp / bid : null;
    const retA = ask != null && previousAsk != null && previousAsk > 0 ? (ask / previousAsk) - 1 : null;
    const retB = bid != null && previousBid != null && previousBid > 0 ? (bid / previousBid) - 1 : null;

    return { t, timestamp, label, ask, bid, a: ask, b: bid, v: volume, p: price, sp, spPct, retA, retB };
  }

  function normalizePublicSeries(rawSeries, kind) {
    const normalized = [];
    let previousAsk = null, previousBid = null;
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
    if (!rawItemData || typeof rawItemData !== 'object') return { levels: [], data: {} };
    const sourceLevels = rawItemData.data && typeof rawItemData.data === 'object' ? rawItemData.data : {};
    const normalizedData = {};
    for (const [level, levelData] of Object.entries(sourceLevels)) {
      if (!levelData || typeof levelData !== 'object') continue;
      normalizedData[level] = {
        daily: normalizePublicSeries(levelData.d || levelData.daily || [], 'daily'),
        hourly: normalizePublicSeries(levelData.h || levelData.hourly || [], 'hourly'),
        vwap: levelData.vwap || { p1d: null, p3d: null, p7d: null },
      };
    }
    const levels = Array.isArray(rawItemData.levels)
      ? rawItemData.levels.map((l) => String(l))
      : Object.keys(normalizedData).sort((a, b) => Number(a) - Number(b));
    return { ...rawItemData, levels, data: normalizedData };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHART HELPERS (ported from the observatory)
  // ═══════════════════════════════════════════════════════════════════
  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function formatNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return value.toLocaleString('en-US');
  }

  function formatCompactNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    if (value >= 1e9) return (value / 1e9).toFixed(2).replace(/\.0+$/, '') + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2).replace(/\.0+$/, '') + 'M';
    if (value >= 100e3) return (value / 1e3).toFixed(0) + 'k';
    return value.toLocaleString('en-US');
  }

  const formatCurrency = formatNumber;
  const formatPercent = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '-');

  function getEffectivePrice(price) {
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  }

  function getSpanTickStep(minValue, maxValue) {
    let span = Math.max(0, maxValue - minValue);
    if (!Number.isFinite(span) || span <= 0) {
      const refValue = Math.abs(minValue) || 1;
      span = refValue * 0.1;
    }
    if (!Number.isFinite(span) || span <= 0) return 1;
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
    [5000000000, 100000000], [10000000000, 200000000], [30000000000, 500000000], [50000000000, 1000000000], [100000000000, 2000000000],
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
      while (tick <= end) { prices.push(tick); tick += step; }
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

  function windowPoints(points, windowKey, anchorTs) {
    if (!points.length) return [];
    const config = WINDOW_CONFIG[windowKey];
    if (!config) return points;
    const timestamps = points
      .map((p) => p.timestamp)
      .filter((ts) => typeof ts === 'number' && Number.isFinite(ts) && ts > 0);
    const anchor = typeof anchorTs === 'number' && anchorTs > 0
      ? anchorTs
      : (timestamps.length ? Math.max(...timestamps) : null);
    if (anchor == null) return points.slice(-config.hours);
    const windowStart = anchor - (config.hours * 60 * 60 * 1000);
    return points.filter((p) => typeof p.timestamp === 'number' && p.timestamp >= windowStart);
  }

  function displayBucketMsForWindow(windowKey) {
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

  function buildChart(points, width, height, fixedMinValue, fixedMaxValue, windowConfig, anchorTs, bucketMs, smooth) {
    const errorReturn = (msg) => ({
      html: `<div class="mwi-mo-error">${msg}</div>`,
      pointPositions: [],
      pointData: [],
    });

    if (!points.length) return errorReturn('No data in this time window.');
    const yValues = points.flatMap((p) => [p.ask, p.bid, p.p]).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (!yValues.length) return errorReturn('No usable ask or bid values available for this selection yet.');

    const maxValue = fixedMaxValue !== null ? fixedMaxValue : Math.max(...yValues);
    const minValue = fixedMinValue !== null ? fixedMinValue : Math.min(...yValues);
    const tickStep = getSpanTickStep(minValue, maxValue);
    const paddedMin = Math.floor(minValue / tickStep) * tickStep - (tickStep * 2);
    const paddedMax = Math.ceil(maxValue / tickStep) * tickStep + tickStep;
    const span = paddedMax - paddedMin;

    const maxLabelLength = formatNumber(Math.max(Math.abs(paddedMax), Math.abs(paddedMin))).length;
    const padding = { top: 20, right: 48, bottom: 34, left: Math.max(60, maxLabelLength * 7 + 12) };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const halfHourMs = 30 * 60 * 1000;
    const gapMs = typeof bucketMs === 'number' && bucketMs > 0 ? bucketMs * 1.5 : null;
    let windowStart = null;
    let scaleX;

    if (windowConfig && typeof anchorTs === 'number' && anchorTs > 0) {
      const windowMs = windowConfig.hours * 60 * 60 * 1000;
      windowStart = anchorTs - windowMs;
      scaleX = (point) => {
        if (!point || typeof point.timestamp !== 'number') return padding.left;
        const displayTs = windowConfig.hours <= 24 ? Math.round(point.timestamp / halfHourMs) * halfHourMs : point.timestamp;
        return padding.left + ((displayTs - windowStart) / windowMs) * innerWidth;
      };
    } else {
      scaleX = (_, index) => padding.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    }

    const scaleY = (value) => padding.top + (1 - (value - paddedMin) / span) * innerHeight;

    const pointPositions = points.map((point, index) => ({
      index,
      x: scaleX(point, index),
      askY: typeof point.ask === 'number' && point.ask > 0 ? scaleY(point.ask) : null,
      bidY: typeof point.bid === 'number' && point.bid > 0 ? scaleY(point.bid) : null,
      pY: typeof point.p === 'number' && point.p > 0 ? scaleY(point.p) : null,
    }));

    const validPriceIndices = [];
    for (let i = 0; i < points.length; i++) {
      if (getEffectivePrice(points[i].ask) != null || getEffectivePrice(points[i].bid) != null) validPriceIndices.push(i);
    }

    const lineSegments = (accessor) => {
      const idxs = [];
      for (let i = 0; i < points.length; i++) {
        if (accessor(points[i]) != null) idxs.push(i);
      }
      const solid = [];
      const dashed = [];
      let current = [];
      for (let k = 0; k < idxs.length; k++) {
        const i = idxs[k];
        if (k > 0) {
          const prev = idxs[k - 1];
          const prevTs = points[prev]?.timestamp;
          const currTs = points[i]?.timestamp;
          const timeGap = typeof prevTs === 'number' && typeof currTs === 'number' ? currTs - prevTs : 0;
          const hasMissingPoints = i - prev > 1;
          if (hasMissingPoints || (gapMs != null && timeGap > gapMs)) {
            if (current.length > 0) { solid.push(current); current = []; }
            dashed.push([prev, i]);
          }
        }
        current.push(i);
      }
      if (current.length > 0) solid.push(current);
      return { solid, dashed, all: idxs.length ? [idxs] : [] };
    };

    // Monotone cubic interpolation (Fritsch-Carlson): smooth, never overshoots.
    const smoothSegmentPath = (seg, accessor) => {
      const pts = seg.map((i) => ({ x: pointPositions[i].x, y: scaleY(accessor(points[i])) }));
      const n = pts.length;
      if (n === 0) return '';
      if (n === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      if (n === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
      const delta = [];
      for (let k = 0; k < n - 1; k++) {
        const h = pts[k + 1].x - pts[k].x;
        delta.push(h !== 0 ? (pts[k + 1].y - pts[k].y) / h : 0);
      }
      const m = new Array(n);
      m[0] = delta[0];
      m[n - 1] = delta[n - 2];
      for (let k = 1; k < n - 1; k++) m[k] = delta[k - 1] * delta[k] <= 0 ? 0 : (delta[k - 1] + delta[k]) / 2;
      for (let k = 0; k < n - 1; k++) {
        if (delta[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
        const a = m[k] / delta[k];
        const b = m[k + 1] / delta[k];
        const s = a * a + b * b;
        if (s > 9) { const tau = 3 / Math.sqrt(s); m[k] = tau * a * delta[k]; m[k + 1] = tau * b * delta[k]; }
      }
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let k = 0; k < n - 1; k++) {
        const h = pts[k + 1].x - pts[k].x;
        const c1x = pts[k].x + h / 3;
        const c1y = pts[k].y + (m[k] * h) / 3;
        const c2x = pts[k + 1].x - h / 3;
        const c2y = pts[k + 1].y - (m[k + 1] * h) / 3;
        d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${pts[k + 1].x.toFixed(1)} ${pts[k + 1].y.toFixed(1)}`;
      }
      return d;
    };

    const straightSegmentPath = (seg, accessor) => seg
      .map((i, k) => `${k === 0 ? 'M' : 'L'} ${pointPositions[i].x.toFixed(1)} ${scaleY(accessor(points[i])).toFixed(1)}`)
      .join(' ');

    const segmentLine = (seg, accessor) => smooth ? smoothSegmentPath(seg, accessor) : straightSegmentPath(seg, accessor);

    const segmentPath = (segments, accessor) => segments.map((seg) => segmentLine(seg, accessor)).join(' ');

    const segmentArea = (segments, accessor) => segments
      .filter((seg) => seg.length > 1)
      .map((seg) => {
        const line = segmentLine(seg, accessor);
        const firstIdx = seg[0];
        const lastIdx = seg[seg.length - 1];
        const bottomY = padding.top + innerHeight;
        return `${line} L ${pointPositions[lastIdx].x.toFixed(1)} ${bottomY.toFixed(1)} L ${pointPositions[firstIdx].x.toFixed(1)} ${bottomY.toFixed(1)} Z`;
      })
      .join(' ');

    const askLine = lineSegments((point) => getEffectivePrice(point.ask));
    const bidLine = lineSegments((point) => getEffectivePrice(point.bid));

    const grid = [];
    const priceTicks = generatePriceTicks(paddedMin, paddedMax);
    const gridLeftX = padding.left;
    const gridRightX = width - padding.right;
    for (const tickValue of priceTicks) {
      const y = padding.top + (1 - (tickValue - paddedMin) / span) * innerHeight;
      grid.push(`<line x1="${gridLeftX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${gridRightX.toFixed(1)}" y2="${y.toFixed(1)}" class="chart-grid" />`);
      grid.push(`<text x="${(gridLeftX - 12).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-label chart-label-y">${formatCompactNumber(tickValue)}</text>`);
    }

    const isIntraday = windowConfig && windowConfig.hours <= 24;
    let lastLabelX = -100;
    let lastDisplayedLabel = null;
    const xAxis = points.map((point, index) => {
      const pos = pointPositions[index];
      const fullLabel = point.label || point.t || '';
      let displayLabel = fullLabel;
      if (isIntraday) {
        displayLabel = fullLabel.includes(',') ? fullLabel.split(',')[1].trim() : fullLabel;
      } else if (typeof point.timestamp === 'number' && typeof bucketMs === 'number' && bucketMs > 0) {
        const endTs = point.timestamp + bucketMs - 1;
        displayLabel = formatDayLabel(new Date(endTs).toISOString().split('T')[0]);
      } else if (displayLabel.includes(' - ')) {
        displayLabel = displayLabel.split(' - ')[1].trim();
      }
      if (displayLabel === lastDisplayedLabel) return '';
      if (pos.x - lastLabelX < 60) return '';
      lastDisplayedLabel = displayLabel;
      lastLabelX = pos.x;
      return `<text x="${pos.x.toFixed(1)}" y="${height - 6}" text-anchor="middle" class="chart-label">${escapeHtml(displayLabel)}</text>`;
    }).filter(Boolean);

    const rightEdgeX = width - padding.right;
    if (windowConfig && typeof anchorTs === 'number' && anchorTs > 0 && rightEdgeX - lastLabelX >= 60) {
      const anchorDate = new Date(anchorTs);
      const anchorLabel = isIntraday
        ? formatHourLabel(anchorDate.toISOString())
        : formatDayLabel(anchorDate.toISOString().split('T')[0]);
      if (anchorLabel !== lastDisplayedLabel) {
        xAxis.push(`<text x="${rightEdgeX.toFixed(1)}" y="${height - 6}" text-anchor="end" class="chart-label">${escapeHtml(anchorLabel)}</text>`);
      }
    }
    const xAxisSvg = xAxis.join('');

    // Volume bars
    const volumes = points.map((p) => p.v || 0).filter((v) => v > 0);
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
    const volStep = Math.max(1, getVolumeTickStep(maxVolume));
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

    const smaPeriod = 5;
    const smaWindowMs = typeof bucketMs === 'number' && bucketMs > 0 ? bucketMs * (smaPeriod - 1) : null;
    const volumeTrend = points.map((pt, i) => {
      if (smaWindowMs == null) {
        let sum = 0, count = 0;
        for (let j = Math.max(0, i - smaPeriod + 1); j <= i; j++) { sum += points[j]?.v || 0; count++; }
        return count > 0 ? sum / count : 0;
      }
      const end = pt?.timestamp;
      if (typeof end !== 'number') return 0;
      let sum = 0;
      for (let j = i; j >= 0; j--) {
        const tj = points[j]?.timestamp;
        if (typeof tj !== 'number' || end - tj > smaWindowMs) break;
        sum += points[j]?.v || 0;
      }
      return sum / smaPeriod;
    });
    const scaleVolumeY = (vol) => volumeBaseY - (vol / maxVolumeForScale) * volumeBarMaxHeight;
    const volumeTrendPathStr = points.map((_, i) => `${i === 0 ? 'M' : 'L'} ${pointPositions[i].x.toFixed(1)} ${scaleVolumeY(volumeTrend[i]).toFixed(1)}`).join(' ');
    const volumeTrendSvg = volumeTrend.some((v) => v > 0)
      ? `<path d="${volumeTrendPathStr}" fill="none" stroke="#f39c12" stroke-width="1.5" opacity="0.9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 4" />`
      : '';

    const volumeAxisLabels = [];
    for (let tickVal = volStep; tickVal <= maxVolumeForScale; tickVal += volStep) {
      const yPos = volumeBaseY - (volumeBarMaxHeight * (tickVal / maxVolumeForScale));
      volumeAxisLabels.push(`<line x1="${padding.left}" y1="${yPos.toFixed(1)}" x2="${width - padding.right}" y2="${yPos.toFixed(1)}" class="chart-grid" stroke-dasharray="4 4" opacity="0.6" /><text x="${volumeTextX.toFixed(1)}" y="${yPos.toFixed(1)}" text-anchor="start" class="chart-label chart-label-y chart-label-volume" alignment-baseline="middle" dominant-baseline="middle" font-size="10px">${formatCompactNumber(tickVal)}</text>`);
    }
    const volTitleY = volumeBaseY - volumeBarMaxHeight - 14;
    const volumeAxis = pointPositions.length > 0
      ? `<text x="${volumeTextX.toFixed(1)}" y="${volTitleY.toFixed(1)}" text-anchor="start" class="chart-label chart-label-y chart-label-volume" font-weight="bold">Vol</text>${volumeAxisLabels.join('')}`
      : '';

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
      let leftExtDist, rightExtDist;
      if (firstIdx < points.length - 1) leftExtDist = (pointPositions[firstIdx + 1].x - firstX) / 2;
      else leftExtDist = (innerWidth / 2) * 0.25;
      if (lastIdx > 0) rightExtDist = (lastX - pointPositions[lastIdx - 1].x) / 2;
      else rightExtDist = (innerWidth / 2) * 0.25;
      const leftExtX = firstX - leftExtDist;
      const rightExtX = lastX + rightExtDist;
      return {
        left: `M ${leftExtX.toFixed(1)} ${firstY.toFixed(1)} L ${firstX.toFixed(1)} ${firstY.toFixed(1)}`,
        right: `M ${lastX.toFixed(1)} ${lastY.toFixed(1)} L ${rightExtX.toFixed(1)} ${lastY.toFixed(1)}`,
      };
    };

    const askExtensions = toExtensionPaths((point) => getEffectivePrice(point.ask));
    const bidExtensions = toExtensionPaths((point) => getEffectivePrice(point.bid));

    const vpLine = lineSegments((point) => (typeof point.p === 'number' && point.p > 0 ? point.p : null));
    const vpExtensions = toExtensionPaths((point) => typeof point.p === 'number' && point.p > 0 ? point.p : null);
    const vpLineSvg = vpLine.solid.length ? `<path d="${segmentPath(vpLine.solid, (point) => point.p)}" class="chart-line chart-line-vp" />` : '';
    const vpDottedSvg = vpLine.dashed.length ? `<path d="${segmentPath(vpLine.dashed, (point) => point.p)}" class="chart-line chart-line-vp" stroke-dasharray="4 4" stroke-width="2" opacity="0.5" fill="none" />` : '';

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
              <linearGradient id="mwi-mo-ask-fill" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#00d9ff;stop-opacity:0.15" />
                <stop offset="100%" style="stop-color:#00d9ff;stop-opacity:0" />
              </linearGradient>
              <linearGradient id="mwi-mo-bid-fill" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#c77dff;stop-opacity:0.15" />
                <stop offset="100%" style="stop-color:#c77dff;stop-opacity:0" />
              </linearGradient>
            </defs>
            ${grid.join('')}
            <path d="${segmentArea(askLine.all, (p) => getEffectivePrice(p.ask))}" class="chart-area chart-area-ask" fill="url(#mwi-mo-ask-fill)" />
            <path d="${segmentArea(bidLine.all, (p) => getEffectivePrice(p.bid))}" class="chart-area chart-area-bid" fill="url(#mwi-mo-bid-fill)" />
            <path d="${segmentPath(askLine.solid, (p) => getEffectivePrice(p.ask))}" class="chart-line chart-line-ask" />
            <path d="${segmentPath(askLine.dashed, (p) => getEffectivePrice(p.ask))}" class="chart-line chart-line-ask" stroke-dasharray="4 4" opacity="0.5" fill="none" />
            <path d="${segmentPath(bidLine.solid, (p) => getEffectivePrice(p.bid))}" class="chart-line chart-line-bid" />
            <path d="${segmentPath(bidLine.dashed, (p) => getEffectivePrice(p.bid))}" class="chart-line chart-line-bid" stroke-dasharray="4 4" opacity="0.5" fill="none" />
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
            ${xAxisSvg}
          </svg>
          <div id="mwi-mo-hover" class="chart-hover is-hidden"></div>
          <div id="mwi-mo-guide" class="chart-guide is-hidden"></div>
        </div>
      `,
      pointPositions,
      pointData: points,
      padding,
      innerWidth,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // MARKETPLACE STATS STRIP
  // ═══════════════════════════════════════════════════════════════════
  function pctChange(cur, base) {
    if (cur == null || base == null || base === 0) return null;
    return ((cur - base) / base) * 100;
  }

  function computeStats(levelData, anchorTs) {
    const hourly = levelData.hourly || [];
    const daily = levelData.daily || [];
    const vwap = levelData.vwap || {};
    const hourMs = 60 * 60 * 1000;

    const latest = hourly.length ? hourly[hourly.length - 1] : (daily.length ? daily[daily.length - 1] : null);
    const now = typeof anchorTs === 'number' && anchorTs > 0
      ? anchorTs
      : (latest && latest.timestamp ? latest.timestamp : Date.now());
    const cutoff24 = now - 24 * hourMs;
    const cutoff48 = now - 48 * hourMs;

    let vol24 = 0, vol24Prev = 0;
    let pvCur = 0, pvCurV = 0, pvPrev = 0, pvPrevV = 0;
    for (const pt of hourly) {
      if (pt.timestamp > cutoff24) {
        vol24 += pt.v || 0;
        if (pt.p > 0 && pt.v > 0) { pvCur += pt.p * pt.v; pvCurV += pt.v; }
      } else if (pt.timestamp > cutoff48) {
        vol24Prev += pt.v || 0;
        if (pt.p > 0 && pt.v > 0) { pvPrev += pt.p * pt.v; pvPrevV += pt.v; }
      }
    }

    const cutoff7d = now - 7 * 24 * hourMs;
    const cutoff14d = now - 14 * 24 * hourMs;
    const last7 = daily.filter((p) => typeof p.timestamp === 'number' && p.timestamp > cutoff7d);
    const prev7 = daily.filter((p) => typeof p.timestamp === 'number' && p.timestamp > cutoff14d && p.timestamp <= cutoff7d);
    const sumV = (arr) => arr.reduce((s, p) => s + (p.v || 0), 0);
    const vol7d = last7.length ? sumV(last7) : null;
    const vol7dPrev = prev7.length ? sumV(prev7) : null;

    let pv7 = 0, pv7V = 0;
    for (const pt of prev7) if (pt.p > 0 && pt.v > 0) { pv7 += pt.p * pt.v; pv7V += pt.v; }

    // Ask/bid reference ~7 days ago (nearest available point).
    const refTarget = now - 7 * 24 * hourMs;
    let refAsk = null, refBid = null, refDiff = Infinity;
    for (const pt of [...hourly, ...daily]) {
      if (typeof pt.timestamp !== 'number' || pt.ask == null) continue;
      const d = Math.abs(pt.timestamp - refTarget);
      if (d < refDiff) { refDiff = d; refAsk = pt.ask; refBid = pt.bid; }
    }

    const p1d = vwap.p1d || null;
    const p7d = vwap.p7d || null;

    return {
      p1d,
      p7d,
      vol24h: vol24,
      vol7d,
      ask: latest ? latest.ask : null,
      bid: latest ? latest.bid : null,
      trends: {
        p1d: pvCurV > 0 && pvPrevV > 0 ? pctChange(pvCur / pvCurV, pvPrev / pvPrevV) : null,
        p7d: pv7V > 0 && p7d ? pctChange(p7d, pv7 / pv7V) : null,
        vol24h: pctChange(vol24, vol24Prev),
        vol7d: pctChange(vol7d, vol7dPrev),
      },
      askVs7d: latest && latest.ask != null && refAsk != null ? pctChange(latest.ask, refAsk) : null,
      bidVs7d: latest && latest.bid != null && refBid != null ? pctChange(latest.bid, refBid) : null,
    };
  }

  function insufficientHtml() {
    return '<span class="mwi-mo-insufficient">Insufficient Data</span>';
  }

  function trendArrowHtml(pct) {
    return `<span class="mwi-mo-trend-arrow">${pct > 0 ? '\u2191' : '\u2193'}</span>`;
  }

  function trendHtml(pct) {
    if (pct == null || !Number.isFinite(pct)) return insufficientHtml();
    if (Math.abs(pct) < TREND_THRESHOLD) return '<span class="mwi-mo-trend-flat">no change</span>';
    const cls = Math.abs(pct) < MILD_TREND_THRESHOLD ? 'mwi-mo-trend-mild' : (pct > 0 ? 'mwi-mo-trend-up' : 'mwi-mo-trend-down');
    return `<span class="${cls}">${trendArrowHtml(pct)} ${Math.abs(pct).toFixed(1)}%</span>`;
  }

  function vsPctHtml(pct) {
    if (pct == null || !Number.isFinite(pct)) return insufficientHtml();
    if (Math.abs(pct) < TREND_THRESHOLD) return '<span class="mwi-mo-trend-flat">no change</span>';
    const cls = Math.abs(pct) < MILD_TREND_THRESHOLD ? 'mwi-mo-trend-mild' : (pct > 0 ? 'mwi-mo-trend-up' : 'mwi-mo-trend-down');
    return ` <span class="${cls}">${trendArrowHtml(pct)} ${Math.abs(pct).toFixed(1)}% vs 7d</span>`;
  }

  function statCell(label, value, trend) {
    const trendHtmlStr = trend ? `<span class="mwi-mo-stat-trend">${trend}</span>` : '';
    return `<div class="mwi-mo-stat"><span class="mwi-mo-stat-label">${label}</span><span class="mwi-mo-stat-value">${value}</span>${trendHtmlStr}</div>`;
  }

  function statCellsHtml(stats) {
    return [
      statCell('Ask', formatNumber(stats.ask), vsPctHtml(stats.askVs7d)),
      statCell('Bid', formatNumber(stats.bid), vsPctHtml(stats.bidVs7d)),
      statCell('1d VWAP', formatNumber(stats.p1d), trendHtml(stats.trends.p1d)),
      statCell('7d VWAP', formatNumber(stats.p7d), trendHtml(stats.trends.p7d)),
      statCell('Vol 24h', formatNumber(stats.vol24h), trendHtml(stats.trends.vol24h)),
      statCell('Vol 7d', formatNumber(stats.vol7d), trendHtml(stats.trends.vol7d)),
    ].join('');
  }

  function buildMarketplaceStripHTML(stats, collapsed) {
    return `
      <div class="mwi-mo-strip-bar">
        <button class="mwi-mo-strip-toggle" type="button" title="Show/hide quick overview">${collapsed ? '▸' : '▾'}</button>
        <span class="mwi-mo-strip-label">Quick overview</span>
      </div>
      <div class="mwi-mo-stats"${collapsed ? ' style="display:none"' : ''}>${statCellsHtml(stats)}</div>
    `;
  }

  let mpStrip = null;
  let mpStripKey = null;

  async function renderMarketplaceStrip(slug, level, name) {
    const panel = document.querySelector('[class*="MarketplacePanel_currentItem"]');
    if (!panel) return;
    const orderBook = document.querySelector('[class*="MarketplacePanel_orderBook"]');
    const key = `${slug}::${level}`;
    const needsCreate = !mpStrip || !mpStrip.isConnected;
    if (needsCreate) {
      mpStrip = document.createElement('div');
      mpStrip.className = 'mwi-mo-mp-strip';
      mpStrip.title = 'Open market chart';
      mpStrip.addEventListener('click', (e) => {
        if (e.target.closest('.mwi-mo-strip-toggle')) {
          e.stopPropagation();
          stripCollapsed = !stripCollapsed;
          GM_setValue('mwi_mo_strip_collapsed', stripCollapsed);
          const statsEl = mpStrip.querySelector('.mwi-mo-stats');
          const btn = mpStrip.querySelector('.mwi-mo-strip-toggle');
          if (statsEl) statsEl.style.display = stripCollapsed ? 'none' : '';
          if (btn) btn.textContent = stripCollapsed ? '▸' : '▾';
          return;
        }
        const s = mpStrip.dataset.slug;
        if (s) openFor(s, mpStrip.dataset.level || '0', mpStrip.dataset.name || null);
      });
      try {
        const navContainer = document.querySelector('[class*="MarketplacePanel_marketNavButtonContainer"]');
        if (navContainer) {
          navContainer.insertAdjacentElement('afterend', mpStrip);
        } else if (orderBook) {
          const listingButtons = orderBook.querySelector('[class*="MarketplacePanel_newListingButtonsContainer"]');
          const orderBooks = orderBook.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
          if (listingButtons) {
            listingButtons.insertAdjacentElement('afterend', mpStrip);
          } else if (orderBooks && orderBooks.parentElement) {
            orderBooks.parentElement.insertBefore(mpStrip, orderBooks);
          } else {
            orderBook.appendChild(mpStrip);
          }
        } else {
          panel.insertAdjacentElement('afterend', mpStrip);
        }
      } catch (err) {
        return;
      }
    }
    mpStrip.dataset.slug = slug;
    mpStrip.dataset.level = level || '0';
    mpStrip.dataset.name = name || '';
    if (!needsCreate && key === mpStripKey) return;
    mpStripKey = key;
    try {
      const itemData = await getBundle(slug);
      const norm = normalizePublicItemData(itemData);
      const lvls = norm.levels || ['0'];
      let useLevel = level;
      if (!lvls.includes(useLevel)) useLevel = lvls.includes('0') ? '0' : lvls[0];
      const levelData = norm.data[useLevel] || {};
      const stats = computeStats(levelData, getDataAnchorTs(await getIndex()));
      mpStrip.innerHTML = buildMarketplaceStripHTML(stats, stripCollapsed);
    } catch (err) {
      mpStrip.innerHTML = '';
    }
  }

  function hideMarketplaceStrip() {
    if (mpStrip) {
      mpStrip.remove();
      mpStrip = null;
    }
    mpStripKey = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL
  // ═══════════════════════════════════════════════════════════════════
  const modalState = {
    slug: null,
    name: null,
    level: '0',
    window: '7d',
    itemData: null,
    iconUrl: null,
    anchorTs: null,
    pos: GM_getValue('mwi_mo_pos', null),
    size: GM_getValue('mwi_mo_size', null),
    dragging: false,
  };

  // Persisted settings (tiny; bundles stay in-memory)
  let autoOpenMarketplace = GM_getValue('mwi_mo_auto_open', true);
  let showContextMenuButton = GM_getValue('mwi_mo_show_menu_btn', true);
  let smoothLines = GM_getValue('mwi_mo_smooth', false);
  let stripCollapsed = GM_getValue('mwi_mo_strip_collapsed', false);
  let resizeMinH = 44;

  let modal = null;

  async function renderSearchResults(query) {
    const resultsEl = modal && modal.querySelector('.mwi-mo-search-results');
    if (!resultsEl) return;
    const index = await getIndex();
    const q = (query || '').trim().toLowerCase();
    const items = (index.items || [])
      .filter((it) => !q || (it.name || '').toLowerCase().includes(q) || (it.slug || '').toLowerCase().includes(q))
      .slice(0, 40);

    if (!items.length) {
      resultsEl.innerHTML = '<div class="mwi-mo-search-empty">No matches</div>';
    } else {
      resultsEl.innerHTML = items.map((it) => {
        const file = ((index.iconFiles || {})[it.slug] || {}).svg || `${it.slug}.svg`;
        const url = `${API_BASE}/assets/item_icons/${encodeURIComponent(file)}`;
        return `<button class="mwi-mo-search-item" data-slug="${escapeHtml(it.slug)}" data-name="${escapeHtml(it.name || '')}"><img src="${escapeHtml(url)}" alt="" /><span>${escapeHtml(it.name || it.slug)}</span></button>`;
      }).join('');
    }
    resultsEl.style.display = '';
  }

  function ensureModal() {
    if (modal && modal.isConnected) return modal;
    modal = document.createElement('div');
    modal.id = 'mwi-mo-modal';
    modal.innerHTML = `
      <div class="mwi-mo-header">
        <img class="mwi-mo-item-icon" alt="" />
        <span class="mwi-mo-title" title="Click to search for an item"></span>
        <input class="mwi-mo-search" type="text" placeholder="Search item..." style="display:none" />
        <div class="mwi-mo-search-results" style="display:none"></div>
        <div class="mwi-mo-header-actions">
          <button class="mwi-mo-btn mwi-mo-refresh" title="Refresh data">↻</button>
          <button class="mwi-mo-btn mwi-mo-close" title="Close">✕</button>
        </div>
      </div>
      <div class="mwi-mo-body">
        <div class="mwi-mo-controls">
          <div class="mwi-mo-pills mwi-mo-levels"></div>
          <div class="mwi-mo-pills mwi-mo-windows"></div>
          <label class="mwi-mo-switch" title="Toggle smooth / straight lines">
            <span class="mwi-mo-switch-label left">Straight</span>
            <input type="checkbox" class="mwi-mo-smooth-toggle" />
            <span class="mwi-mo-switch-slider"></span>
            <span class="mwi-mo-switch-label right">Smooth</span>
          </label>
        </div>
        <div class="mwi-mo-stats"></div>
        <div class="mwi-mo-chart"></div>
      </div>
      <div class="mwi-mo-footer">
        <span class="mwi-mo-updated"></span>
        <span class="mwi-mo-footer-settings">
          <label class="mwi-mo-auto" title="Automatically open the chart when the marketplace selected item changes">
            <input type="checkbox" class="mwi-mo-auto-toggle" />
            Auto-open
          </label>
          <label class="mwi-mo-auto" title="Show the Market Chart button in item context menus">
            <input type="checkbox" class="mwi-mo-menu-toggle" />
            Menu button
          </label>
        </span>
        <span class="mwi-mo-brand">
          <a class="mwi-mo-link" target="_blank" rel="noopener noreferrer" href="${API_BASE}">Market Observatory</a>
        </span>
      </div>
      <div class="mwi-mo-resize" title="Resize"></div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.mwi-mo-close').addEventListener('click', closeModal);
    modal.querySelector('.mwi-mo-refresh').addEventListener('click', () => refreshModal(true));

    const autoToggle = modal.querySelector('.mwi-mo-auto-toggle');
    autoToggle.checked = autoOpenMarketplace;
    autoToggle.addEventListener('change', () => {
      autoOpenMarketplace = autoToggle.checked;
      GM_setValue('mwi_mo_auto_open', autoOpenMarketplace);
    });

    const menuToggle = modal.querySelector('.mwi-mo-menu-toggle');
    menuToggle.checked = showContextMenuButton;
    menuToggle.addEventListener('change', () => {
      showContextMenuButton = menuToggle.checked;
      GM_setValue('mwi_mo_show_menu_btn', showContextMenuButton);
    });

    const smoothToggle = modal.querySelector('.mwi-mo-smooth-toggle');
    smoothToggle.checked = smoothLines;
    smoothToggle.addEventListener('change', () => {
      smoothLines = smoothToggle.checked;
      GM_setValue('mwi_mo_smooth', smoothLines);
      renderChart();
    });

    // item search
    const titleEl = modal.querySelector('.mwi-mo-title');
    const searchEl = modal.querySelector('.mwi-mo-search');
    const resultsEl = modal.querySelector('.mwi-mo-search-results');
    const closeSearch = () => {
      searchEl.style.display = 'none';
      resultsEl.style.display = 'none';
      titleEl.style.display = '';
    };
    titleEl.addEventListener('click', () => {
      titleEl.style.display = 'none';
      searchEl.style.display = '';
      searchEl.value = '';
      renderSearchResults('');
      searchEl.focus();
    });
    searchEl.addEventListener('input', () => renderSearchResults(searchEl.value));
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
    searchEl.addEventListener('blur', () => setTimeout(closeSearch, 150));
    resultsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.mwi-mo-search-item');
      if (!btn) return;
      const slug = btn.getAttribute('data-slug');
      const name = btn.getAttribute('data-name');
      closeSearch();
      openFor(slug, '0', name);
    });

    // window pills
    modal.querySelector('.mwi-mo-windows').addEventListener('click', (e) => {
      const pill = e.target.closest('.mwi-mo-pill');
      if (!pill || !pill.dataset.window) return;
      modalState.window = pill.dataset.window;
      renderModal();
    });
    // level pills
    modal.querySelector('.mwi-mo-levels').addEventListener('click', (e) => {
      const pill = e.target.closest('.mwi-mo-pill');
      if (!pill || !pill.dataset.level) return;
      modalState.level = pill.dataset.level;
      renderModal();
    });

    // drag
    const header = modal.querySelector('.mwi-mo-header');
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, input, .mwi-mo-title, .mwi-mo-search-results')) return;
      modalState.dragging = true;
      const rect = modal.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const onMove = (ev) => {
        if (!modalState.dragging) return;
        let left = ev.clientX - offsetX;
        let top = ev.clientY - offsetY;
        left = Math.max(0, Math.min(left, window.innerWidth - 60));
        top = Math.max(0, Math.min(top, window.innerHeight - 40));
        modal.style.left = `${left}px`;
        modal.style.top = `${top}px`;
        modalState.pos = { left, top };
      };
      const onUp = () => {
        modalState.dragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        GM_setValue('mwi_mo_pos', modalState.pos);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    // resize (bottom-right handle)
    const resizeHandle = modal.querySelector('.mwi-mo-resize');
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = modal.offsetWidth;
      const startH = modal.offsetHeight;
      const onMove = (ev) => {
        const w = Math.max(420, Math.min(startW + (ev.clientX - startX), window.innerWidth - 16));
        const h = Math.max(resizeMinH, Math.min(startH + (ev.clientY - startY), window.innerHeight - 16));
        modal.style.width = `${w}px`;
        modal.style.height = `${h}px`;
        modalState.size = { width: w, height: h };
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        GM_setValue('mwi_mo_size', modalState.size);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    return modal;
  }

  function applyPosition() {
    if (modalState.pos) {
      const w = modal.offsetWidth || 760;
      const h = modal.offsetHeight || 400;
      const left = Math.max(0, Math.min(modalState.pos.left, window.innerWidth - w));
      const top = Math.max(0, Math.min(modalState.pos.top, window.innerHeight - h));
      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
    } else {
      modal.style.left = `${Math.max(8, window.innerWidth - 780)}px`;
      modal.style.top = '70px';
    }
    if (modalState.size) {
      const w = Math.min(modalState.size.width, window.innerWidth - 16);
      const h = Math.min(modalState.size.height, window.innerHeight - 16);
      modal.style.width = `${Math.max(420, w)}px`;
      modal.style.height = `${Math.max(resizeMinH, h)}px`;
    }
  }

  function openModal() {
    const el = ensureModal();
    applyPosition();
    el.classList.add('mwi-mo-open');
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('mwi-mo-open');
  }

  function renderStats(levelData) {
    const stats = modal.querySelector('.mwi-mo-stats');
    const level = levelData || {};
    const hasData = (level.hourly && level.hourly.length) || (level.daily && level.daily.length);
    if (!hasData) {
      stats.innerHTML = '<div class="mwi-mo-error">No data available.</div>';
      return;
    }
    const cs = computeStats(level, modalState.anchorTs);
    stats.innerHTML = statCellsHtml(cs);
  }

  function usesDailySeries(windowKey) {
    return (WINDOW_CONFIG[windowKey]?.hours || 0) >= (24 * 30);
  }

  function currentSeries() {
    const levelData = (modalState.itemData && modalState.itemData.data[modalState.level]) || {};
    const series = usesDailySeries(modalState.window) ? (levelData.daily || []) : (levelData.hourly || []);
    if (['30d', '60d', '90d', '120d'].includes(modalState.window) && usesDailySeries(modalState.window)) {
      const dailySeries = levelData.daily || [];
      const hourlySeries = levelData.hourly || [];
      if (dailySeries.length > 0 && hourlySeries.length > 0) {
        const bucketMs = displayBucketMsForWindow(modalState.window);
        const now = modalState.anchorTs || Date.now();
        const todayStart = Math.floor(now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        const lastBucketStart = Math.floor(todayStart / bucketMs) * bucketMs;
        const dailyBeforeBucket = dailySeries.filter((p) => p?.timestamp && p.timestamp < lastBucketStart);
        const hourlyFromLastBucket = hourlySeries.filter((p) => p?.timestamp && p.timestamp >= lastBucketStart);
        if (hourlyFromLastBucket.length > 0) return [...dailyBeforeBucket, ...hourlyFromLastBucket];
      }
    }
    return series;
  }

  function currentPoints() {
    return aggregateDisplaySeries(windowPoints(currentSeries(), modalState.window, modalState.anchorTs), modalState.window);
  }

  function renderChart() {
    const chartEl = modal.querySelector('.mwi-mo-chart');
    const points = currentPoints();
    const yValues = points.flatMap((p) => [p.ask, p.bid]).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const globalMin = yValues.length ? Math.min(...yValues) : null;
    const globalMax = yValues.length ? Math.max(...yValues) : null;
    const chart = buildChart(points, CHART_WIDTH, CHART_HEIGHT, globalMin, globalMax, WINDOW_CONFIG[modalState.window], modalState.anchorTs, displayBucketMsForWindow(modalState.window), smoothLines);
    chartEl.innerHTML = chart.html;

    const cachedPosData = chart.pointPositions || [];
    const cachedDataPoints = chart.pointData || [];
    const chartWrap = chartEl.querySelector('.chart-wrap');
    const chartHover = chartEl.querySelector('#mwi-mo-hover');
    const chartGuide = chartEl.querySelector('#mwi-mo-guide');
    if (chartWrap && chartHover && chartGuide && points.length) {
      const svg = chartWrap.querySelector('svg');
      const svgBounds = svg.getBoundingClientRect();
      const svgScaleX = svgBounds.width / CHART_WIDTH;

      const hideHover = () => {
        chartHover.classList.add('is-hidden');
        chartGuide.classList.add('is-hidden');
      };
      const showHoverForClientX = (clientX) => {
        const hoverWidth = 220;
        const hoverGap = 14;
        const hoverMargin = 10;
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
        const hoverLeft = (spaceRight < hoverWidth + hoverGap + hoverMargin)
          ? Math.max(hoverMargin, x - hoverWidth - hoverGap)
          : Math.min(x + hoverGap, svgBounds.width - hoverWidth - hoverMargin);
        chartHover.style.left = `${hoverLeft}px`;
        chartHover.style.top = '20px';
        chartHover.innerHTML = `
          <div class="chart-hover-date">${escapeHtml(point.label)}</div>
          <div class="chart-hover-row"><span>Ask: </span><strong>${formatCurrency(point.a)}</strong></div>
          <div class="chart-hover-row"><span>Bid: </span><strong>${formatCurrency(point.b)}</strong></div>
          <div class="chart-hover-row"><span>Spread: </span><strong>${formatCurrency(point.sp)}</strong></div>
          <div class="chart-hover-row"><span>Spread %: </span><strong>${formatPercent(point.spPct)}</strong></div>
          <div class="chart-hover-row"><span>Volume: </span><strong>${formatNumber(point.v)}</strong></div>
          <div class="chart-hover-row"><span>VWAP: </span><strong>${formatCurrency(point.p)}</strong></div>
        `;
      };
      chartWrap.onmouseleave = hideHover;
      chartWrap.onmousemove = (event) => showHoverForClientX(event.clientX);
    }
  }

  function renderModal() {
    if (!modal || !modal.classList.contains('mwi-mo-open')) return;
    const itemData = modalState.itemData;
    if (!itemData) return;

    const title = modal.querySelector('.mwi-mo-title');
    const levelStr = modalState.level === '0' ? '' : ` <span class="mwi-mo-lvl">+${modalState.level}</span>`;
    title.innerHTML = `${escapeHtml(modalState.name || itemData.name || modalState.slug)}${levelStr}`;

    const iconEl = modal.querySelector('.mwi-mo-item-icon');
    if (iconEl) {
      iconEl.src = modalState.iconUrl || '';
      iconEl.style.display = modalState.iconUrl ? '' : 'none';
    }

    const link = modal.querySelector('.mwi-mo-link');
    const lvls = itemData.levels || [];
    const defaultLevel = lvls.includes('0') ? '0' : (lvls[0] || '0');
    const levelQuery = modalState.level === defaultLevel ? '' : `?level=${encodeURIComponent(modalState.level)}`;
    link.href = `${API_BASE}/items/${encodeURIComponent(modalState.slug)}${levelQuery}`;

    const levelsEl = modal.querySelector('.mwi-mo-levels');
    const hasEnhancement = (itemData.levels || []).length > 1;
    levelsEl.style.display = hasEnhancement ? '' : 'none';
    levelsEl.innerHTML = hasEnhancement
      ? itemData.levels
          .map((l) => `<button class="mwi-mo-pill ${l === modalState.level ? 'mwi-mo-active' : ''}" data-level="${escapeHtml(l)}">+${escapeHtml(l)}</button>`)
          .join('')
      : '';

    const windowsEl = modal.querySelector('.mwi-mo-windows');
    windowsEl.innerHTML = Object.keys(WINDOW_CONFIG)
      .map((key) => `<button class="mwi-mo-pill ${key === modalState.window ? 'mwi-mo-active' : ''}" data-window="${key}">${WINDOW_CONFIG[key].label}</button>`)
      .join('');

    const levelData = itemData.data[modalState.level] || {};
    renderStats(levelData);
    renderChart();

    // Min height: keep the header and footer bars visible
    const headerH = modal.querySelector('.mwi-mo-header')?.offsetHeight || 46;
    const footerH = modal.querySelector('.mwi-mo-footer')?.offsetHeight || 36;
    resizeMinH = Math.min(headerH + footerH + 8, window.innerHeight - 16);
    const curH = modal.offsetHeight;
    if (curH < resizeMinH) modal.style.height = `${resizeMinH}px`;

    const updated = modal.querySelector('.mwi-mo-updated');
    const ts = bundleCache.fetchedAt;
    updated.textContent = ts ? `Updated ${new Date(ts).toLocaleTimeString()}` : '';
  }

  async function refreshModal(force) {
    if (!modalState.slug) return;
    try {
      const itemData = await getBundle(modalState.slug, force);
      modalState.itemData = normalizePublicItemData(itemData);
      modalState.anchorTs = getDataAnchorTs(await getIndex());
      const levels = modalState.itemData.levels || ['0'];
      if (!levels.includes(modalState.level)) modalState.level = levels.includes('0') ? '0' : levels[0];
      modalState.iconUrl = await resolveItemIconUrl(modalState.slug);
      renderModal();
    } catch (err) {
      if (modal) {
        const chartEl = modal.querySelector('.mwi-mo-chart');
        chartEl.innerHTML = `<div class="mwi-mo-error">Failed to load data for ${escapeHtml(modalState.name || modalState.slug)}: ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  async function openFor(slug, level, name) {
    modalState.slug = slug;
    modalState.level = level || '0';
    modalState.name = name || null;
    openModal();
    await refreshModal(false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOM DETECTION + INJECTION
  // ═══════════════════════════════════════════════════════════════════
  let lastMarketplaceKey = null;

  function injectMarketplaceChart(container) {
    if (container.querySelector('.mwi-mo-market-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'mwi-mo-market-btn mwi-mo-btn';
    btn.textContent = '📈';
    btn.title = 'Open market chart';
    btn.style.cssText = 'position:absolute;top:4px;right:4px;width:30px;height:30px;z-index:5;';
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const slug = slugFromSprite(container);
      if (!slug) return;
      const level = levelFromRoot(container);
      const name = container.querySelector('svg[aria-label]')?.getAttribute('aria-label') || null;
      const isOpen = modal && modal.classList.contains('mwi-mo-open');
      if (isOpen && modalState.slug === slug && modalState.level === level) {
        closeModal();
        return;
      }
      await openFor(slug, level, name);
    });
    container.style.position = 'relative';
    container.appendChild(btn);
  }

  function handleMarketplace() {
    const panel = document.querySelector('[class*="MarketplacePanel_currentItem"]');
    if (!panel) {
      hideMarketplaceStrip();
      lastMarketplaceKey = null;
      return;
    }
    const slug = slugFromSprite(panel);
    if (!slug) return;
    const level = levelFromRoot(panel);
    const name = panel.querySelector('svg[aria-label]')?.getAttribute('aria-label') || null;
    injectMarketplaceChart(panel);
    const key = `${slug}::${level}`;
    if (key !== lastMarketplaceKey) {
      lastMarketplaceKey = key;
      if (autoOpenMarketplace) openFor(slug, level, name);
    }
    renderMarketplaceStrip(slug, level, name);
  }

  async function handleContextMenu() {
    const menu = document.querySelector('[class*="Item_actionMenu"]');
    if (!menu) return;
    if (menu.querySelector('.mwi-mo-menu-btn')) return;
    if (!showContextMenuButton) return;
    const name = nameFromRoot(menu);
    if (!name) return;
    let slug = null;
    try {
      slug = await nameToSlug(name);
    } catch (err) {
      return;
    }
    if (!slug || !isTradableForSlug(slug)) return;
    const level = levelFromRoot(menu);
    const btn = document.createElement('button');
    btn.className = 'mwi-mo-menu-btn mwi-mo-btn';
    btn.textContent = '📈 Market Chart';
    btn.style.cssText = 'width:100%;margin-top:6px;';
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await openFor(slug, level, name);
      } catch (err) {
        console.error('[MWI Market Chart] open failed:', err);
      }
    });
    menu.appendChild(btn);
  }

  let observerDebounce = null;
  const observer = new MutationObserver(() => {
    if (observerDebounce) return;
    observerDebounce = setTimeout(() => {
      observerDebounce = null;
      try {
        handleMarketplace();
        handleContextMenu();
      } catch (err) {
        console.warn('[MWI Market Chart] observer tick error:', err);
      }
    }, 150);
  });

  function startObserver() {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', startObserver);
  }

  // Poll the open item periodically
  setInterval(() => {
    if (modal && modal.classList.contains('mwi-mo-open') && modalState.slug) {
      refreshModal(true).catch((err) => console.warn('[MWI Market Chart] poll error:', err));
    }
  }, POLL_INTERVAL_MS);

  startObserver();
})();