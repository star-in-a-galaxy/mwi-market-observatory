/* Market page (/market): daily market turnover, price index, categories and enhancement levels.
 * Data: data/public/market.json, built by scripts/compute-market.js.
 * The page renders into a shadow root so its styles stay separate from styles.css. */
(function () {
  'use strict';

  const CSS = `
    :host { display: block; overflow-anchor: none;
      --text-secondary: #c3cad5; --grid: #2a3242; --baseline: #3d4759; --base-mark: #c77dff; --up: #22c55e; --down: #ef4444; }
    * { box-sizing: border-box; }
    h2 { color: var(--text-primary); }
    .card { margin-top: 1rem; background: var(--bg-panel); border: 1px solid var(--stroke); border-radius: 20px; box-shadow: var(--shadow); padding: 1.1rem; }
    .pill { border: 1px solid var(--stroke); background: var(--bg-panel-light); color: var(--text-primary); border-radius: 999px; padding: 0.35rem 0.8rem; cursor: pointer; font-size: 0.82rem; font-family: inherit; white-space: nowrap; transition: all 160ms ease; }
    .pill:hover { border-color: rgba(255,255,255,.25); }
    .pill.active { background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-brand) 100%); border-color: transparent; box-shadow: 0 4px 12px rgba(124,58,237,.3); }
    .pill:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }

    .filters { position: sticky; top: 0; z-index: 5; padding: .75rem 1.2rem; }
    .query { margin: 0; font-size: 1.05rem; line-height: 1.9; color: var(--text-secondary); }
    .q-select { appearance: none; -webkit-appearance: none; background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23c3cad5' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right .15em center / .62em;
      background-color: rgba(255,255,255,.07); border: 0; border-radius: 8px; color: var(--text-primary); font: inherit; font-weight: 600; padding: .05em 1.5em .05em .5em; margin: 0 .1em; cursor: pointer; line-height: 1.5; background-position: right .5em center; transition: background-color 120ms ease; }
    .q-select:hover { background-color: rgba(255,255,255,.13); }
    .q-select:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }
    .q-select option { background: var(--bg-panel-light); color: var(--text-primary); font-weight: 400; }
    .q-date { position: relative; display: inline-block; }
    .q-date input { position: absolute; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; color-scheme: dark; }
    .q-link { background: none; border: 0; padding: 0 0 0 .5em; color: var(--text-muted); font: inherit; font-size: .9em; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
    .q-link:hover { color: var(--text-primary); }
    .q-link:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; border-radius: 3px; }

    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .75rem; }
    .stats-grid > div { padding: 1rem; border: 1px solid var(--stroke); border-radius: 16px; background: rgba(255,255,255,.03); }
    .stat-label { display: block; color: var(--text-muted); font-size: .8rem; margin-bottom: .4rem; }
    .stat-value { font-size: 1.6rem; font-weight: 650; }
    .stat-trend { display: block; font-size: .78rem; font-weight: 600; margin-top: .3rem; }
    .stat-trend-up { color: var(--up); } .stat-trend-down { color: var(--down); } .stat-trend-flat { color: var(--text-muted); font-weight: 400; }
    .stat-sub { color: var(--text-muted); font-weight: 400; }

    .chart-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: .4rem; }
    .chart-head h2 { margin: 0; font-size: 1.05rem; }
    .chart-head p { margin: .2rem 0 0; color: var(--text-muted); font-size: .82rem; max-width: 720px; }
    .view-toggle { display: flex; gap: .3rem; align-items: center; }
    .clear-chip { border: 1px solid var(--stroke); background: var(--bg-panel-light); color: var(--text-primary); border-radius: 999px; padding: .35rem .8rem; font: inherit; font-size: .82rem; cursor: pointer; margin-right: .4rem; }
    .clear-chip:hover { border-color: rgba(255,255,255,.3); }
    .clear-chip:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }
    .legend { display: flex; flex-wrap: wrap; gap: .3rem .9rem; margin: .5rem 0 .2rem; font-size: .8rem; color: var(--text-secondary); }
    .legend-item { display: inline-flex; align-items: center; gap: .4rem; background: none; border: 0; color: inherit; font: inherit; padding: .15rem .2rem; border-radius: 6px; }
    button.legend-item { cursor: pointer; } button.legend-item:hover { background: rgba(255,255,255,.06); }
    .legend-item.active { color: var(--text-primary); font-weight: 600; background: rgba(255,255,255,.09); padding: .15rem .55rem; }
    .legend-item.dim { opacity: .45; }
    .key-rect { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .key-line { width: 14px; height: 2px; border-radius: 1px; display: inline-block; }
    .chart { position: relative; width: 100%; }
    .chart svg { display: block; width: 100%; overflow: visible; }
    .axis-text { fill: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
    .base-label { fill: #0f1419; font-size: 11px; font-weight: 650; }
    .end-label { fill: var(--text-secondary); font-size: 11px; font-weight: 600; }

    .tooltip { position: absolute; pointer-events: none; background: var(--bg-panel-light); border: 1px solid var(--stroke); border-radius: 10px; padding: .5rem .65rem; font-size: .78rem; box-shadow: 0 8px 24px rgba(0,0,0,.45); min-width: 150px; z-index: 3; display: none; }
    .tooltip .tt-date { color: var(--text-muted); margin-bottom: .3rem; }
    .tooltip .tt-row { display: flex; align-items: center; gap: .45rem; line-height: 1.55; }
    .tooltip .tt-row strong { font-weight: 650; color: var(--text-primary); min-width: 54px; text-align: right; font-variant-numeric: tabular-nums; }
    .tooltip .tt-row span { color: var(--text-secondary); }

    .multiples { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: .9rem; margin-top: .6rem; }
    .multiple { border: 1px solid var(--stroke); border-radius: 14px; padding: .6rem .7rem .3rem; background: rgba(255,255,255,.02); cursor: pointer; transition: border-color 160ms ease; }
    .multiple:hover { border-color: rgba(255,255,255,.22); }
    .multiple:focus-visible { outline: 2px solid var(--accent-cyan); outline-offset: 2px; }
    .multiple.selected { border-color: var(--accent-purple); }
    .multiple-head { display: flex; justify-content: space-between; align-items: baseline; font-size: .85rem; }
    .multiple-head b { display: inline-flex; align-items: center; gap: .4rem; font-weight: 600; }
    .multiple-vals { display: inline-flex; gap: .7rem; }
    .multiple-vals > span { display: inline-flex; align-items: center; gap: .3rem; }
    .multiple-head span { color: var(--text-secondary); font-variant-numeric: tabular-nums; }

    table { width: 100%; border-collapse: collapse; margin-top: .6rem; font-size: .82rem; }
    th, td { padding: .35rem .5rem; text-align: right; border-bottom: 1px solid var(--grid); font-variant-numeric: tabular-nums; }
    th:first-child, td:first-child { text-align: left; }
    th { color: var(--text-muted); font-weight: 500; }
    .table-wrap { overflow-x: auto; margin-top: 1rem; }
    .sub-head { display: flex; justify-content: space-between; align-items: center; gap: .6rem; flex-wrap: wrap; margin-top: .4rem; }
    .sub-head .legend { margin: 0; }
    .enh-multiples .multiple { cursor: default; }
    .enh-multiples .multiple:hover { border-color: var(--stroke); }
    @media (min-width: 1000px) { .enh-multiples { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
    .enh-table { margin-top: .4rem; font-size: .86rem; }
    .enh-table th, .enh-table td { padding: .55rem .6rem; white-space: nowrap; }
    .enh-table th { font-size: .78rem; }
    .enh-table tr.group th { border-bottom: 0; padding-bottom: 0; }
    .enh-table th.grp { text-align: center; color: var(--text-secondary); font-weight: 600; }
    .enh-table th.grp { background: linear-gradient(var(--grid), var(--grid)) no-repeat center bottom / calc(100% - 1rem) 1px; padding-bottom: .3rem; }
    .enh-table .thin.up, .enh-table .up .thin, .enh-table .down .thin { color: var(--text-muted); }
    .enh-table tfoot td { border-bottom: 0; border-top: 1px solid var(--baseline); color: var(--text-secondary); }
    .enh-table .lvl { font-weight: 600; }
    .enh-table .share { display: inline-flex; align-items: center; gap: .5rem; justify-content: flex-end; }
    .enh-table .share-bar { display: inline-block; width: 64px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.07); overflow: hidden; }
    .enh-table .share-bar i { display: block; height: 100%; background: var(--text-muted); border-radius: 3px; }
    .enh-table .up { color: var(--up); } .enh-table .down { color: var(--down); }
    .enh-table .thin { color: var(--text-muted); text-decoration: underline dotted rgba(255,255,255,.3); text-underline-offset: 3px; cursor: help; }
    @media (max-width: 640px) { .enh-table { font-size: .8rem; } .enh-table th, .enh-table td { padding: .45rem .3rem; } .enh-table th { white-space: normal; vertical-align: bottom; } .enh-table .share-bar { display: none; } }
  `;

  const MARKUP = `
    <section class="card filters" aria-label="What the charts show">
      <p class="query">Showing <select class="q-select" id="q-tier" aria-label="Items"></select> in <select class="q-select" id="q-scope" aria-label="Category"></select> <select class="q-select" id="q-range" aria-label="Time range"></select>, drawn as <select class="q-select" id="q-smooth" aria-label="Line style"></select>, indexed to the 7 days to <span class="q-date"><button type="button" class="q-select" id="f-base-btn" aria-label="Change base date"></button><input type="date" id="f-base" tabindex="-1" aria-hidden="true" /></span><button type="button" class="q-link" id="f-base-reset"></button>.</p>
    </section>
    <section class="card"><div class="stats-grid" id="tiles"></div></section>
    <section class="card">
      <div class="chart-head"><div><h2 id="t-turnover">Turnover</h2></div></div>
      <div class="legend" id="lg-turnover"></div>
      <div class="chart" id="c-turnover"></div>
    </section>
    <section class="card">
      <div class="chart-head"><div><h2 id="t-stack">By category</h2></div>
      <div class="view-toggle"><button type="button" class="clear-chip" data-fk="clear:stack" hidden></button><span id="v-stack" class="view-toggle"></span></div></div>
      <div class="legend" id="lg-stack"></div>
      <div class="chart" id="c-stack"></div>
    </section>
    <section class="card">
      <div class="chart-head"><div><h2>Categories</h2></div>
      <div class="view-toggle"><button type="button" class="clear-chip" data-fk="clear:mult" hidden></button><span id="v-mult" class="view-toggle"></span></div></div>
      <div class="legend" id="lg-mult"></div>
      <div class="multiples" id="c-mult"></div>
    </section>
    <section class="card">
      <div class="chart-head"><div><h2>Enhancement levels</h2><p class="base-line" id="enh-sub"></p></div>
      <div class="view-toggle" id="v-enh"></div></div>
      <div class="sub-head"><div class="legend" id="lg-enh"></div><div class="view-toggle" id="v-enh-m"></div></div>
      <div class="multiples enh-multiples" id="c-enh"></div>
      <div class="table-wrap"><table class="enh-table" id="t-enh"></table></div>
    </section>
  `;

  function mount(host, DATA) {
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${MARKUP}`;
    // the chart code below looks things up via `document`: point it at the shadow root
    const document = {
      getElementById: (id) => shadow.getElementById(id),
      querySelector: (sel) => shadow.querySelector(sel),
      querySelectorAll: (sel) => shadow.querySelectorAll(sel),
      get activeElement() { return shadow.activeElement; },
      createElement: (tag) => window.document.createElement(tag),
      createElementNS: (ns, tag) => window.document.createElementNS(ns, tag),
      createTextNode: (text) => window.document.createTextNode(text),
    };

    const CAT_COLORS = { resources: '#3987e5', consumables: '#d95926', books: '#199e70', labyrinth: '#c98500', keys: '#d55181', equipment: '#0ca30c', accessories: '#9085e9', tools: '#e66767' };
    const TIER_KEYS = ['top10', 'top30', 'top50', 'top100', 'top200', 'all'];
    const C_TURN = '#3987e5', C_PRICE = '#d95926', C_MARKET = '#8b95a5', C_AVG = '#e8eef5';
    const cap = (s) => s[0].toUpperCase() + s.slice(1);

    const state = { base: new URLSearchParams(location.search).get("base"), scope: 'all', tier: 'all', range: 'all', smooth: true, stack: 'coins', multMeasure: 'turnover', enhTier: 'all', enhMeasure: 'turnover' };
    const N = DATA.dates.length;
    const GAP_DATES = new Set(DATA.gaps.map((g) => g.date));

    // ---------- data helpers ----------
    const ok = (v) => v != null && Number.isFinite(v);
    const avgOf = (w) => { const f = w.filter(ok); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : null; };
    const ma7 = (a) => a.map((v, i) => (ok(v) ? avgOf(a.slice(Math.max(0, i - 6), i + 1)) : null));
    // Index base: the 7 days ending on the chosen date (?base=YYYY-MM-DD), Aug 8-14 by default.
    const DEFAULT_BASE = '2026-08-14';
    function selIdx() {
      const i = DATA.dates.indexOf(state.base || DEFAULT_BASE);
      return i >= 6 ? i : Math.max(6, DATA.dates.indexOf(DEFAULT_BASE));
    }
    function baseRange() { const i = selIdx(); return [i - 6, i]; }
    const turnoverIndex = (a) => { const [b0, b1] = baseRange(); const base = avgOf(a.slice(b0, b1 + 1)); return a.map((v) => (ok(v) && ok(base) ? (v / base) * 100 : null)); };
    const priceIndex = (a) => { const [b0, b1] = baseRange(); const base = avgOf(a.slice(b0, b1 + 1)); return a.map((v) => (ok(v) && ok(base) ? (v / base) * 100 : null)); };
    const finite = (a) => a.filter(ok);
    const lastValid = (a, from = a.length - 1) => { for (let i = from; i >= 0; i--) if (ok(a[i])) return i; return -1; };
    const pctWeek = (a, i) => (i >= 7 && ok(a[i]) && ok(a[i - 7]) ? (a[i] / a[i - 7] - 1) * 100 : null);
    const pctChange = (a, i) => { const p = lastValid(a, i - 1); return ok(a[i]) && p >= 0 ? (a[i] / a[p] - 1) * 100 : null; };
    const sm = (a) => (state.smooth ? ma7(a) : a);
    const startIdx = () => (state.range === 'all' ? 0 : Math.max(0, N - (state.range === '3m' ? 91 : 30)));
    const view = (a) => a.slice(startIdx());
    const viewDates = () => DATA.dates.slice(startIdx());
    const S = (scope) => DATA.scopes[scope];
    const series = (scope, measure, tier) => (measure === 'turnover' ? turnoverIndex(S(scope).turnover[tier]) : priceIndex(S(scope).price[tier]));

    function fmtCoins(v) {
      if (!ok(v)) return 'no data';
      const a = Math.abs(v);
      if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
      return String(Math.round(v));
    }
    const fmtIdx = (v) => (ok(v) ? v.toFixed(1) : 'no data');
    const fmtPct = (v) => !ok(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function fmtShort(d) { const p = d.split('-'); return MONTHS[+p[1] - 1] + ' ' + (+p[2]); }
    const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${MONTHS[+m - 1]} ${+dd}, ${y}`; };
    const weekday = (d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(d + 'T00:00:00Z').getUTCDay()];

    function niceTicks(min, max, count = 5) {
      const span = max - min || 1;
      const step0 = span / count;
      const mag = Math.pow(10, Math.floor(Math.log10(step0)));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
      const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
      const t = [];
      for (let v = lo; v <= hi + step * 1e-9; v += step) t.push(+v.toFixed(10));
      return t;
    }

    // ---------- DOM helpers ----------
    const NS = 'http://www.w3.org/2000/svg';
    function el(tag, attrs = {}, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
    function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

    function pills(container, options, current, onPick) {
      container.replaceChildren();
      for (const [value, label] of options) {
        const b = h('button', 'pill' + (value === current ? ' active' : ''), label);
        b.type = 'button'; b.setAttribute('aria-pressed', value === current); b.dataset.fk = container.id + ':' + value;
        b.onclick = () => onPick(value);
        container.appendChild(b);
      }
    }
    function legend(container, items) {
      container.replaceChildren();
      for (const it of items) {
        const b = h(it.onClick ? 'button' : 'span', 'legend-item' + (it.dim ? ' dim' : '') + (it.active ? ' active' : ''));
        if (it.onClick) { b.type = 'button'; b.onclick = it.onClick; b.setAttribute('aria-pressed', !!it.active); b.dataset.fk = container.id + ':' + it.label; }
        if (it.kind !== 'none') { const k = h('span', it.kind === 'line' ? 'key-line' : 'key-rect'); k.style.background = it.color; b.appendChild(k); }
        b.appendChild(document.createTextNode(it.label));
        container.appendChild(b);
      }
    }

    // ---------- chart frame: axes, grid, crosshair + tooltip ----------
    function frame(container, { height, dates, yMin, yMax, yFmt, ref, compact }) {
      container.replaceChildren();
      const W = Math.max(compact ? 180 : 280, container.clientWidth);
      const pad = { l: compact ? 34 : 52, r: compact ? 8 : 104, t: 10, b: 24 };
      const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
      const svg = el('svg', { viewBox: `0 0 ${W} ${height}`, height, role: 'img' }, container);
      const n = dates.length;
      const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
      const ticks = niceTicks(yMin, yMax, compact ? 3 : 5);
      const lo = ticks[0], hi = ticks[ticks.length - 1];
      const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
      const g = el('g', {}, svg);
      for (const t of ticks) {
        el('line', { x1: pad.l, x2: pad.l + iw, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }, g);
        el('text', { x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-text' }, g).textContent = yFmt(t);
      }
      if (ref != null && ref >= lo && ref <= hi) el('line', { x1: pad.l, x2: pad.l + iw, y1: y(ref), y2: y(ref), stroke: 'var(--baseline)', 'stroke-width': 1.5 }, g);
      // month ticks
      let lastM = null, lastX = -1e9;
      dates.forEach((d, i) => {
        const m = d.slice(0, 7);
        if (m !== lastM) {
          lastM = m;
          if (+d.slice(8) <= 7 || i === 0) {
            const tx = x(i);
            if (tx < pad.l + iw - 20 && tx - lastX > 34) (lastX = tx, el('text', { x: tx, y: height - 6, 'text-anchor': i === 0 ? 'start' : 'middle', class: 'axis-text' }, g).textContent = MONTHS[+d.slice(5, 7) - 1]);
          }
        }
      });
      const plot = el('g', {}, svg);
      const [rb0, rb1] = baseRange().map((i) => i - startIdx());
      if (rb1 >= 0 && rb0 < n) {
        const c0 = Math.max(0, rb0), c1 = Math.min(n - 1, rb1);
        const half = iw / Math.max(1, n - 1) / 2;
        const bxl = Math.max(pad.l, x(c0) - half), bxr = Math.min(pad.l + iw, x(c1) + half);
        el('rect', { x: bxl, y: pad.t, width: bxr - bxl, height: ih, fill: 'var(--base-mark)', opacity: 0.16 }, g);
        const mark = el('g', { 'pointer-events': 'none' }, svg);
        el('line', { x1: bxl, x2: bxl, y1: pad.t, y2: pad.t + ih, stroke: 'var(--base-mark)', 'stroke-width': 1, opacity: 0.6 }, mark);
        if (rb1 < n) {
          el('line', { x1: x(rb1), x2: x(rb1), y1: pad.t - 2, y2: pad.t + ih, stroke: 'var(--bg-panel)', 'stroke-width': 4 }, mark);
          el('line', { x1: x(rb1), x2: x(rb1), y1: pad.t - 2, y2: pad.t + ih, stroke: 'var(--base-mark)', 'stroke-width': 2 }, mark);
        }
        if (!compact) {
          const label = 'base ' + fmtShort(DATA.dates[selIdx()]);
          const tw = label.length * 6.2 + 10;
          const ax = rb1 < n ? x(rb1) : bxr;
          const lx = ax + 4 + tw < pad.l + iw ? ax + 4 : ax - 4 - tw;
          el('rect', { x: lx, y: pad.t, width: tw, height: 17, rx: 8, fill: 'var(--base-mark)' }, mark);
          el('text', { x: lx + tw / 2, y: pad.t + 12, 'text-anchor': 'middle', class: 'base-label' }, mark).textContent = label;
        }
      }
      return { svg, plot, x, y, W, height, pad, iw, ih, n, lo, hi };
    }

    function hover(container, f, dates, rowsAt, opts = {}) {
      const tip = h('div', 'tooltip'); container.appendChild(tip);
      const cross = el('line', { y1: f.pad.t, y2: f.pad.t + f.ih, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 1, visibility: 'hidden' }, f.svg);
      const dots = el('g', {}, f.svg);
      const hit = el('rect', { x: f.pad.l, y: f.pad.t, width: f.iw, height: f.ih, fill: 'transparent', ...(opts.noFocus ? { tabindex: -1 } : { tabindex: 0, 'aria-label': 'Chart: use arrow keys to read values' }), 'data-fk': 'hit:' + (container.id || container.closest('[data-fk]')?.dataset.fk || '') }, f.svg);
      let cur = null;
      function show(i) {
        cur = i;
        const xi = f.x(i);
        cross.setAttribute('x1', xi); cross.setAttribute('x2', xi); cross.setAttribute('visibility', 'visible');
        const rows = rowsAt(i);
        dots.replaceChildren();
        for (const r of rows) if (ok(r.yv) && r.kind === 'line') el('circle', { cx: xi, cy: f.y(r.yv), r: 4, fill: r.color, stroke: 'var(--bg-panel)', 'stroke-width': 2 }, dots);
        if (opts.onIndex) opts.onIndex(i);
        tip.replaceChildren(h('div', 'tt-date', `${weekday(dates[i])}, ${fmtDate(dates[i])}`));
        for (const r of rows) {
          const row = h('div', 'tt-row');
          const k = h('span', r.kind === 'rect' ? 'key-rect' : 'key-line'); k.style.background = r.color;
          row.append(k, h('strong', null, r.value), h('span', null, r.label));
          tip.appendChild(row);
        }
        tip.style.display = 'block';
        const scale = container.clientWidth / f.W;
        const left = xi * scale;
        const tw = tip.offsetWidth;
        tip.style.left = (left + 14 + tw > container.clientWidth ? left - 14 - tw : left + 14) + 'px';
        tip.style.top = Math.max(0, f.pad.t) + 'px';
      }
      function hide() { cur = null; cross.setAttribute('visibility', 'hidden'); dots.replaceChildren(); tip.style.display = 'none'; if (opts.onIndex) opts.onIndex(null); }
      hit.addEventListener('pointermove', (e) => {
        const r = f.svg.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * f.W;
        const i = Math.round(((px - f.pad.l) / f.iw) * (f.n - 1));
        show(Math.max(0, Math.min(f.n - 1, i)));
      });
      hit.addEventListener('pointerleave', hide);
      // keyboard reading only where the chart is a tab stop: in Chromium, focus/key listeners alone make an SVG shape tabbable
      if (!opts.noFocus) {
        hit.addEventListener('focus', () => show(f.n - 1));
        hit.addEventListener('blur', hide);
        hit.addEventListener('keydown', (e) => {
          if (cur == null) return;
          if (e.key === 'ArrowLeft') { show(Math.max(0, cur - 1)); e.preventDefault(); }
          if (e.key === 'ArrowRight') { show(Math.min(f.n - 1, cur + 1)); e.preventDefault(); }
        });
      }
    }

    // half a day minus a pixel: next to a missing day, lines and areas run on this far, so the gap is one day wide
    const gapReach = (f) => Math.max(0, f.iw / Math.max(1, f.n - 1) / 2 - 1);
    const pathOf = (vals, f) => {
      const r = gapReach(f), n = vals.length;
      let out = '';
      vals.forEach((v, i) => {
        if (!ok(v)) return;
        const x = f.x(i), y = f.y(v).toFixed(1);
        if (i > 0 && ok(vals[i - 1])) out += `L${x.toFixed(1)},${y}`;
        else out += `M${(i > 0 ? x - r : x).toFixed(1)},${y}L${x.toFixed(1)},${y}`;
        if (i < n - 1 && !ok(vals[i + 1])) out += `L${(x + r).toFixed(1)},${y}`;
      });
      return out;
    };
    function line(f, vals, color, width = 2, extra = {}) {
      return el('path', Object.assign({ d: pathOf(vals, f), fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, extra), f.plot);
    }
    function endLabels(f, items) {
      // items: {v, text}; skip labels that would collide
      const placed = [];
      items.filter((it) => ok(it.v)).map((it) => ({ ...it, py: f.y(it.v) })).sort((a, b) => a.py - b.py).forEach((it) => {
        if (placed.some((p) => Math.abs(p - it.py) < 14)) return;
        placed.push(it.py);
        el('text', { x: f.pad.l + f.iw + 8, y: it.py + 4, class: 'end-label' }, f.svg).textContent = it.text;
      });
    }

    // ---------- sections ----------
    const RANGE_LABEL = () => ({ all: 'since ' + fmtShort(DATA.dates[0]), '3m': 'over the last 90 days', '1m': 'over the last 30 days' });
    const TIER_PHRASE = { all: 'all items', top10: 'the top 10 items', top30: 'the top 30 items', top50: 'the top 50 items', top100: 'the top 100 items', top200: 'the top 200 items' };
    let measurer;
    function fitSelect(sel) {
      // size the select to its chosen option, so the sentence reads without gaps
      if (!measurer) { measurer = h('span'); measurer.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-weight:600'; document.querySelector('.query').appendChild(measurer); }
      measurer.style.font = getComputedStyle(sel).font;
      measurer.textContent = sel.options[sel.selectedIndex].textContent;
      sel.style.width = `calc(${measurer.offsetWidth}px + 2.1em)`;
    }
    function fillSelect(id, options, current, onPick) {
      const sel = document.getElementById(id);
      sel.replaceChildren(...options.map(([v, label]) => { const o = h('option', null, label); o.value = String(v); o.selected = String(v) === String(current); return o; }));
      sel.onchange = () => onPick(sel.value);
      fitSelect(sel);
    }
    function renderFilters() {
      for (const b of document.querySelectorAll('.clear-chip')) {
        b.hidden = state.scope === 'all';
        b.textContent = '× Show all categories';
        b.setAttribute('aria-label', 'Show all categories (now showing ' + cap(state.scope) + ')');
        b.onclick = () => set({ scope: 'all' });
      }
      fillSelect('q-tier', TIER_KEYS.map((k) => [k, TIER_PHRASE[k]]), state.tier, (v) => set({ tier: v }));
      fillSelect('q-scope', [['all', 'the whole market'], ...DATA.categories.map((c) => [c, c])], state.scope, (v) => set({ scope: v }));
      const rl = RANGE_LABEL();
      fillSelect('q-range', ['all', '3m', '1m'].map((k) => [k, rl[k]]), state.range, (v) => set({ range: v }));
      fillSelect('q-smooth', [['true', '7-day averages'], ['false', 'daily values']], String(state.smooth), (v) => set({ smooth: v === 'true' }));

      const bi = document.getElementById('f-base'), bb = document.getElementById('f-base-btn');
      bi.min = DATA.dates[6]; bi.max = DATA.dates[N - 1]; bi.value = DATA.dates[selIdx()];
      bb.textContent = fmtShort(DATA.dates[selIdx()]);
      bb.onclick = () => { try { bi.showPicker(); } catch (e) { bi.focus(); } };
      bi.onchange = () => { if (bi.value >= DATA.dates[6] && bi.value <= DATA.dates[N - 1]) set({ base: bi.value }); };
      const br = document.getElementById('f-base-reset');
      const changed = state.base && state.base !== DEFAULT_BASE;
      br.style.display = changed ? '' : 'none';
      br.textContent = 'reset to ' + fmtShort(DEFAULT_BASE);
      br.onclick = () => set({ base: null });

      pills(document.getElementById('v-mult'), [['turnover', 'Turnover index'], ['price', 'Price index']], state.multMeasure, (v) => set({ multMeasure: v }));
      pills(document.getElementById('v-stack'), [['coins', 'Coins'], ['share', 'Share %']], state.stack, (v) => set({ stack: v }));
    }

    function trendSpan(pct, suffix) {
      if (!ok(pct)) return h('span', 'stat-trend stat-trend-flat', '–');
      pct = Math.round(pct * 10) / 10; // decide the arrow on the shown value, so 0.0% is never up or down
      const s = h('span', 'stat-trend ' + (Math.abs(pct) < 0.05 ? 'stat-trend-flat' : pct > 0 ? 'stat-trend-up' : 'stat-trend-down'));
      s.textContent = (pct > 0 ? '↑ ' : pct < 0 ? '↓ ' : '') + fmtPct(pct).replace(/^[+−]/, '');
      s.appendChild(h('span', 'stat-sub', ' ' + suffix));
      return s;
    }
    function renderTiles() {
      const sc = S(state.scope), t = sc.turnover[state.tier], p = priceIndex(sc.price[state.tier]), ti = turnoverIndex(t), c = sc.count;
      const L = lastValid(t), last = DATA.dates[L];
      const vsWeek = 'vs last ' + weekday(last);
      const tiles = [
        ['Turnover, ' + fmtShort(last), fmtCoins(t[L]), t],
        ['Turnover index', fmtIdx(ti[L]), ti],
        ['Price index', fmtIdx(p[L]), p],
        ['Items traded', c[L].toLocaleString('en-US'), c],
      ];
      const root = document.getElementById('tiles'); root.replaceChildren();
      for (const [label, value, arr] of tiles) {
        const d = h('div');
        d.append(h('span', 'stat-label', label), h('div', 'stat-value', value), trendSpan(pctWeek(arr, L), vsWeek));
        root.appendChild(d);
      }
    }

    function renderTurnover() {
      const c = document.getElementById('c-turnover');
      const raw = S(state.scope).turnover[state.tier];
      const daily = view(raw), avg = view(ma7(raw)), dates = viewDates();
      legend(document.getElementById('lg-turnover'), [{ label: 'Daily', color: C_TURN, kind: 'rect' }, { label: '7-day average', color: C_AVG, kind: 'line' }]);
      const f = frame(c, { height: 280, dates, yMin: 0, yMax: Math.max(...finite(daily)) * 1.05, yFmt: fmtCoins });
      const slot = f.iw / f.n, bw = Math.max(1, Math.min(24, slot - 2));
      const bars = daily.map((v, i) => !ok(v) ? el('g', {}, f.plot) : el('rect', { x: f.x(i) - bw / 2, y: f.y(v), width: bw, height: f.y(f.lo) - f.y(v), rx: Math.min(2, bw / 2), fill: C_TURN, opacity: 0.8 }, f.plot));
      line(f, avg, C_AVG, 2);
      const la = avg[lastValid(avg)]; endLabels(f, [{ v: la, text: fmtCoins(la) + ' avg' }]);
      hover(c, f, dates, (i) => [
        { kind: 'rect', color: C_TURN, label: 'turnover', value: fmtCoins(daily[i]) },
        { kind: 'line', color: C_AVG, label: '7-day average', value: fmtCoins(avg[i]), yv: avg[i] },
        { kind: 'none', color: 'transparent', label: 'vs week before', value: fmtPct(pctWeek(raw, i + startIdx())) },
        { kind: 'none', color: 'transparent', label: 'vs previous day', value: fmtPct(pctChange(raw, i + startIdx())) },
      ], { onIndex: (j) => bars.forEach((b, k) => b.setAttribute('opacity', j == null || k === j ? 0.8 : 0.45)) });
    }

    function renderStack() {
      const c = document.getElementById('c-stack');
      const cats = DATA.categories;
      const dates = viewDates();
      const vals = Object.fromEntries(cats.map((k) => [k, view(state.smooth ? ma7(S(k).turnover.all) : S(k).turnover.all)]));
      const totals = dates.map((_, i) => (cats.every((k) => ok(vals[k][i])) ? cats.reduce((s, k) => s + vals[k][i], 0) : null));
      const segs = []; let s0 = null;
      totals.forEach((t, i) => { if (ok(t) && s0 == null) s0 = i; if ((!ok(t) || i === totals.length - 1) && s0 != null) { segs.push([s0, ok(t) ? i : i - 1]); s0 = null; } });
      const share = state.stack === 'share';
      const v = (k, i) => (!ok(totals[i]) ? null : share ? (vals[k][i] / totals[i]) * 100 : vals[k][i]);
      legend(document.getElementById('lg-stack'), [].concat(cats.map((k) => ({ label: cap(k), color: CAT_COLORS[k], kind: 'rect', dim: state.scope !== 'all' && state.scope !== k, onClick: () => set({ scope: state.scope === k ? 'all' : k }) }))));
      const f = frame(c, { height: 300, dates, yMin: 0, yMax: share ? 100 : Math.max(...finite(totals)) * 1.03, yFmt: share ? (t) => t + '%' : fmtCoins });
      const base = totals.map((t) => (ok(t) ? 0 : null));
      const layers = [];
      const sel = state.scope !== 'all' ? state.scope : null;
      const order = cats; // fixed stack order; the selected category is highlighted in place
      for (const k of order) {
        const top = base.map((b, i) => (ok(b) && ok(v(k, i)) ? b + v(k, i) : null));
        const dim = state.scope !== 'all' && state.scope !== k;
        const r = gapReach(f);
        for (const [a, b] of segs) {
          const xl = a > 0 ? f.x(a) - r : f.x(a), xr = b < dates.length - 1 ? f.x(b) + r : f.x(b);
          let d = 'M' + xl.toFixed(1) + ',' + f.y(top[a]).toFixed(1);
          for (let i = a; i <= b; i++) d += 'L' + f.x(i).toFixed(1) + ',' + f.y(top[i]).toFixed(1);
          d += 'L' + xr.toFixed(1) + ',' + f.y(top[b]).toFixed(1) + 'L' + xr.toFixed(1) + ',' + f.y(base[b]).toFixed(1);
          for (let i = b; i >= a; i--) d += 'L' + f.x(i).toFixed(1) + ',' + f.y(base[i]).toFixed(1);
          d += 'L' + xl.toFixed(1) + ',' + f.y(base[a]).toFixed(1);
          el('path', { d: d + 'Z', fill: CAT_COLORS[k], opacity: dim ? 0.22 : 0.92 }, f.plot);
        }
        layers.push({ k, top: top.slice(), bottom: base.slice() });
        top.forEach((t, i) => (base[i] = t));
      }
      // surface gap between bands
      for (const L of layers) el('path', { d: pathOf(L.top, f), fill: 'none', stroke: 'var(--bg-panel)', 'stroke-width': 1.5 }, f.plot);
      // direct labels at the right edge, inside bands that are tall enough
      const li = lastValid(totals);
      for (const L of layers) {
        const y0 = f.y(L.bottom[li]), y1 = f.y(L.top[li]);
        if (L.k === sel) {
          const sh = (vals[sel][li] / totals[li]) * 100;
          const val = share ? sh.toFixed(sh < 1 ? 2 : 1) + '%' : fmtCoins(vals[sel][li]);
          const ly = Math.min((y0 + y1) / 2 + 4, y0 - 2);
          el('text', { x: f.pad.l + f.iw + 8, y: ly, class: 'end-label' }, f.svg).textContent = cap(sel) + ' ' + val;
        } else if (!sel && y0 - y1 >= 16) el('text', { x: f.pad.l + f.iw + 8, y: (y0 + y1) / 2 + 4, class: 'end-label' }, f.svg).textContent = cap(L.k);
      }
      hover(c, f, dates, (i) => [...cats].reverse().map((k) => ({
        kind: 'rect', color: CAT_COLORS[k], label: cap(k),
        value: !ok(totals[i]) ? 'no data' : share ? ((vals[k][i] / totals[i]) * 100).toFixed(1) + '%' : fmtCoins(vals[k][i]),
      })).concat(state.smooth
        ? [{ kind: 'none', color: 'transparent', label: 'total, 7-day avg', value: fmtCoins(totals[i]) },
           { kind: 'none', color: 'transparent', label: 'total, this day', value: fmtCoins(S('all').turnover.all[i + startIdx()]) }]
        : [{ kind: 'none', color: 'transparent', label: 'total', value: fmtCoins(totals[i]) }]));
    }

    function renderMultiples() {
      legend(document.getElementById('lg-mult'), [{ label: 'Whole market', color: C_MARKET, kind: 'line' }]);
      const root = document.getElementById('c-mult'); root.replaceChildren();
      const m = state.multMeasure, dates = viewDates();
      const market = view(sm(series('all', m, state.tier)));
      const per = Object.fromEntries(DATA.categories.map((k) => [k, view(sm(series(k, m, state.tier)))]));
      const all = finite(Object.values(per).flat().concat(market, [100]));
      const yMin = Math.min(...all) - 2, yMax = Math.max(...all) + 2;
      for (const k of DATA.categories) {
        const card = h('div', 'multiple' + (state.scope === k ? ' selected' : ''));
        card.dataset.fk = 'mult:' + k;
        card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-pressed', state.scope === k);
        card.onclick = () => set({ scope: state.scope === k ? 'all' : k });
        card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.onclick(); } };
        const head = h('div', 'multiple-head');
        const b = h('b'); const key = h('span', 'key-line'); key.style.background = CAT_COLORS[k]; b.append(key, document.createTextNode(cap(k)));
        head.append(b, h('span', null, fmtIdx(per[k][lastValid(per[k])])));
        const chart = h('div', 'chart');
        card.append(head, chart); root.appendChild(card);
        const f = frame(chart, { height: 130, dates, yMin, yMax, yFmt: (t) => String(t), ref: 100, compact: true });
        line(f, market, C_MARKET, 1.5, { opacity: 0.7 });
        line(f, per[k], CAT_COLORS[k], 2);
        hover(chart, f, dates, (i) => [
          { kind: 'line', color: CAT_COLORS[k], label: cap(k), value: fmtIdx(per[k][i]), yv: per[k][i] },
          { kind: 'line', color: C_MARKET, label: 'whole market', value: fmtIdx(market[i]), yv: market[i] },
        ], { noFocus: true }); // the panel itself is the single tab stop
      }
    }

    const ENH_TIERS = [['all', 'All gear'], ['early', 'Early (1–64)'], ['mid', 'Mid (65–94)'], ['end', 'Endgame (95+)']];
    const BAND_LABEL = { '0': '+0', '1-5': '+1 to +5', '6-9': '+6 to +9', '10-12': '+10 to +12', '13+': '+13 and up' };
    const THIN = 15; // fewer items traded a day than this: the price index is noisy

    function renderEnhMultiples() {
      const m = state.enhMeasure, C = m === 'turnover' ? C_TURN : C_PRICE;
      pills(document.getElementById('v-enh-m'), [['turnover', 'Turnover index'], ['price', 'Price index']], m, (v) => set({ enhMeasure: v }));
      legend(document.getElementById('lg-enh'), [{ label: 'All levels', color: C_MARKET, kind: 'line' }]);
      const T = DATA.enh.data[state.enhTier];
      const idx = (x) => view(sm(m === 'turnover' ? turnoverIndex(x.turnover) : priceIndex(x.price)));
      const allLv = idx(T.all);
      const per = Object.fromEntries(DATA.enh.bands.map((b) => [b, idx(T[b])]));
      const vals = finite(Object.values(per).flat().concat(allLv, [100]));
      const yMin = Math.min(...vals) - 2, yMax = Math.max(...vals) + 2;
      const root = document.getElementById('c-enh'); root.replaceChildren();
      const dates = viewDates();
      for (const b of DATA.enh.bands) {
        const card = h('div', 'multiple');
        const head = h('div', 'multiple-head');
        const name = h('b'); const key = h('span', 'key-line'); key.style.background = C; name.append(key, document.createTextNode(BAND_LABEL[b]));
        head.append(name, h('span', null, fmtIdx(per[b][lastValid(per[b])])));
        const chart = h('div', 'chart');
        card.append(head, chart); root.appendChild(card);
        const fr = frame(chart, { height: 130, dates, yMin, yMax, yFmt: (t) => String(t), ref: 100, compact: true });
        line(fr, allLv, C_MARKET, 1.5, { opacity: 0.7 });
        line(fr, per[b], C, 2);
        hover(chart, fr, dates, (i) => [
          { kind: 'line', color: C, label: BAND_LABEL[b], value: fmtIdx(per[b][i]), yv: per[b][i] },
          { kind: 'line', color: C_MARKET, label: 'all levels', value: fmtIdx(allLv[i]), yv: allLv[i] },
        ], { noFocus: true });
      }
    }

    const spanLabel = (i0, i1) => {
      const a = fmtShort(DATA.dates[i0]), b = fmtShort(DATA.dates[i1]);
      return a.split(' ')[0] === b.split(' ')[0] ? a + '–' + b.split(' ')[1] : a + '–' + b;
    };
    function renderEnh() {
      renderEnhMultiples();
      pills(document.getElementById('v-enh'), ENH_TIERS, state.enhTier, (v) => set({ enhTier: v }));
      const [b0, b1] = baseRange();
      const nowL = spanLabel(N - 7, N - 1), prevL = spanLabel(N - 14, N - 8), baseL = spanLabel(b0, b1);
      document.getElementById('enh-sub').textContent = `Gear by item level, daily averages for ${nowL}. Price index: ${baseL} = 100.`;
      const win = (a, i0, i1) => avgOf(a.slice(i0, i1 + 1));
      const T = DATA.enh.data[state.enhTier];
      const row = (x) => {
        const pNow = win(x.price, N - 7, N - 1);
        return { now: win(x.turnover, N - 7, N - 1), prev: win(x.turnover, N - 14, N - 8), base: win(x.turnover, b0, b1),
          price: (pNow / win(x.price, b0, b1)) * 100, pricePrev: (pNow / win(x.price, N - 14, N - 8) - 1) * 100,
          items: win(x.count, N - 7, N - 1) };
      };
      const rows = DATA.enh.bands.map((b) => ({ b, ...row(T[b]) }));
      const tot = row(T.all);
      const t = document.getElementById('t-enh'); t.replaceChildren();
      const head = h('thead');
      const g = h('tr', 'group');
      const th = (text, cls, span) => { const e = h('th', cls, text); if (span) e.colSpan = span; return e; };
      g.append(th('', null), th('Turnover', 'grp', 3), th('', null), th('Price', 'grp', 2), th('', null));
      const hr = h('tr');
      hr.append(th('Enhancement'), th('Per day'), th('vs ' + prevL), th('vs ' + baseL), th('Share'), th('Index'), th('vs ' + prevL), th('Items traded per day'));
      head.append(g, hr); t.appendChild(head);
      const pctCell = (p) => (p = ok(p) ? Math.round(p * 10) / 10 : p, h('td', ok(p) && Math.abs(p) >= 0.05 ? (p > 0 ? 'up' : 'down') : null, ok(p) ? (p > 0 ? '↑ ' : p < 0 ? '↓ ' : '') + fmtPct(p).replace(/^[+−]/, '') : '–'));
      const change = (now, ref) => pctCell(ok(now) && ref > 0 ? (now / ref - 1) * 100 : null);
      const thin = (cell, items) => { if (items < THIN) { cell.firstChild.className = 'thin'; cell.firstChild.title = `Only about ${Math.round(items)} items traded a day, so this moves a lot`; } return cell; };
      const wrapText = (td) => { td.replaceChildren(h('span', null, td.textContent)); return td; };
      const body = h('tbody');
      for (const r of rows) {
        const tr = h('tr');
        tr.appendChild(h('td', 'lvl', BAND_LABEL[r.b]));
        tr.appendChild(h('td', null, fmtCoins(r.now)));
        tr.appendChild(change(r.now, r.prev));
        tr.appendChild(change(r.now, r.base));
        const sh = tot.now > 0 ? (r.now / tot.now) * 100 : 0;
        const shc = h('td'); const wrap = h('span', 'share'); const bar = h('span', 'share-bar'); const fill = h('i'); fill.style.width = sh.toFixed(1) + '%';
        bar.appendChild(fill); wrap.append(h('span', null, sh.toFixed(sh < 10 ? 1 : 0) + '%'), bar); shc.appendChild(wrap); tr.appendChild(shc);
        tr.appendChild(thin(wrapText(h('td', null, fmtIdx(r.price))), r.items));
        tr.appendChild(thin(wrapText(pctCell(r.pricePrev)), r.items));
        tr.appendChild(h('td', null, ok(r.items) ? String(Math.round(r.items)) : '–'));
        body.appendChild(tr);
      }
      t.appendChild(body);
      const foot = h('tfoot'); const fr = h('tr');
      fr.append(h('td', 'lvl', 'All levels'), h('td', null, fmtCoins(tot.now)), change(tot.now, tot.prev), change(tot.now, tot.base), h('td'),
        h('td', null, fmtIdx(tot.price)), pctCell(tot.pricePrev), h('td', null, ok(tot.items) ? String(Math.round(tot.items)) : '–'));
      foot.appendChild(fr); t.appendChild(foot);
    }

    function render() { renderFilters(); renderTiles(); renderTurnover(); renderStack(); renderMultiples(); renderEnh(); }
    function set(patch) {
      // redraw without moving the page: keep the scroll position the reader had
      const x = window.scrollX, y = window.scrollY;
      const fk = document.activeElement?.getAttribute?.('data-fk');
      Object.assign(state, patch);
      if ('base' in patch) {
        // keep the chosen base in the URL, so a shared link shows the same index
        const url = new URL(window.location.href);
        if (state.base) url.searchParams.set('base', state.base); else url.searchParams.delete('base');
        window.history.replaceState(null, '', url);
      }
      render();
      window.scrollTo({ left: x, top: y, behavior: 'instant' });
      // put keyboard focus back on the same control, so Tab continues from here
      if (fk) {
        const same = [...document.querySelectorAll('[data-fk]')].find((e) => e.getAttribute('data-fk') === fk && !e.hidden);
        const fallback = fk === 'clear:stack' ? '[data-fk="lg-stack:Resources"]' : fk === 'clear:mult' ? '[data-fk="mult:resources"]' : null;
        (same || (fallback && document.querySelector(fallback)))?.focus({ preventScroll: true });
      }
    }
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
    render();
  }

  window.MarketPulse = { mount };
})();
