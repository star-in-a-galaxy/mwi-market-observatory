/**
 * Shared VWAP (Volume-Weighted Average Price) calculation utility.
 * Computes rolling VWAP over 1d, 3d, and 7d time windows.
 */

const WINDOWS = {
  p1d: 24 * 3600 * 1000,
  p3d: 72 * 3600 * 1000,
  p7d: 7 * 24 * 3600 * 1000,
};

/**
 * Collect all timed points with valid price and volume for a specific item+level
 * from hourly snapshots.
 *
 * @param {Array} snapshots - Array of hourly snapshot objects
 * @param {string} itemId - The item ID (e.g. "/items/abyssal_essence")
 * @param {string} level - The enhancement level key (e.g. "0", "5")
 * @returns {Array<{ts: number, p: number, v: number}>}
 */
function collectTimedPoints(snapshots, itemId, level) {
  const points = [];

  for (const snapshot of snapshots) {
    const data = snapshot.data || {};
    const itemData = data[itemId];
    if (!itemData || !itemData[level]) continue;

    const entry = itemData[level];
    if (typeof entry.p !== 'number' || entry.p <= 0) continue;
    if (typeof entry.v !== 'number' || entry.v <= 0) continue;

    const fetchedAt = snapshot.fetchedAt || new Date((snapshot.timestamp || 0) * 1000).toISOString();
    const ts = Date.parse(fetchedAt) || (snapshot.timestamp ? snapshot.timestamp * 1000 : 0);
    if (ts <= 0) continue;

    points.push({ ts, p: entry.p, v: entry.v });
  }

  return points;
}

/**
 * Compute rolling VWAP values (p1d, p3d, p7d) for a specific item+level.
 *
 * @param {Array} snapshots - Array of hourly snapshot objects
 * @param {string} itemId - The item ID
 * @param {string} level - The enhancement level key
 * @returns {{p1d: number|null, p3d: number|null, p7d: number|null}}
 */
function computeRollingVwaps(snapshots, itemId, level) {
  const timedPoints = collectTimedPoints(snapshots, itemId, level);
  const result = { p1d: null, p3d: null, p7d: null };

  if (timedPoints.length === 0) return result;

  const latestTs = timedPoints[timedPoints.length - 1].ts;

  for (const [key, windowMs] of Object.entries(WINDOWS)) {
    const cutoff = latestTs - windowMs;
    let totalVol = 0;
    let totalValue = 0;
    for (let i = timedPoints.length - 1; i >= 0; i--) {
      const p = timedPoints[i];
      if (p.ts <= cutoff) break;
      totalVol += p.v;
      totalValue += p.p * p.v;
    }
    result[key] = totalVol > 0 ? Math.round(totalValue / totalVol) : null;
  }

  return result;
}

/**
 * Compute rolling VWAPs for all items and levels in a set of snapshots.
 *
 * @param {Array} snapshots - Array of hourly snapshot objects
 * @returns {Object} Nested object: { [itemId]: { [level]: { p1d, p3d, p7d } } }
 */
function computeAllVwaps(snapshots) {
  const result = {};

  for (const snapshot of snapshots) {
    const data = snapshot.data || {};

    for (const itemId of Object.keys(data)) {
      if (!result[itemId]) result[itemId] = {};

      for (const level of Object.keys(data[itemId])) {
        result[itemId][level] = computeRollingVwaps(snapshots, itemId, level);
      }
    }
  }

  return result;
}

module.exports = {
  collectTimedPoints,
  computeRollingVwaps,
  computeAllVwaps,
  WINDOWS,
};
