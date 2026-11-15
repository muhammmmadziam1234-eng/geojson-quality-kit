// A deliberately simple, slow second opinion on polygon validity. Everything is brute force and
// uses BigInt on the rounded integer grid, so it shares no code (and no rounding behaviour) with
// lib/predicates.mjs. The rules are the ones documented in the README.
const toGrid = (ring, precision) => ring.map(([x, y]) => [BigInt(Math.round(x * 10 ** precision)), BigInt(Math.round(y * 10 ** precision))]);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const sign = v => (v > 0n ? 1 : v < 0n ? -1 : 0);
const min = (a, b) => (a < b ? a : b), max = (a, b) => (a > b ? a : b);
const onBox = (a, b, p) => p[0] >= min(a[0], b[0]) && p[0] <= max(a[0], b[0]) && p[1] >= min(a[1], b[1]) && p[1] <= max(a[1], b[1]);

/** True when the closed segments a1-a2 and b1-b2 have a point in common. */
export function segmentsShare(a1, a2, b1, b2) {
  const d1 = sign(cross(b1, b2, a1)), d2 = sign(cross(b1, b2, a2)), d3 = sign(cross(a1, a2, b1)), d4 = sign(cross(a1, a2, b2));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (d1 === 0 && onBox(b1, b2, a1)) || (d2 === 0 && onBox(b1, b2, a2)) || (d3 === 0 && onBox(a1, a2, b1)) || (d4 === 0 && onBox(a1, a2, b2));
}
export const orientSign = (a, b, c) => sign(cross(a, b, c));
export const areaSignExact = ring => sign(ring.slice(0, -1).reduce((s, p, i) => s + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0n));

function insideRing(p, ring) {
  let inside = false;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1];
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      const left = (p[0] - a[0]) * (b[1] - a[1]), right = (p[1] - a[1]) * (b[0] - a[0]);
      if (b[1] - a[1] > 0n ? left < right : left > right) inside = !inside;
    }
  }
  return inside;
}
const dedupe = ring => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);

/**
 * Judges the rings of one polygon (decimal [x, y] pairs). Returns {ok: true, rings} with the
 * rings in the grid form used for the checks, or {code, details} for the first rule broken, in
 * the documented order: ring length, zero area, self-intersection, rings sharing a point, holes.
 */
export function judgePolygon(rings, precision = 6) {
  const grid = rings.map(ring => {
    let g = dedupe(toGrid(ring, precision));
    if (g.length >= 2 && (g[0][0] !== g[g.length - 1][0] || g[0][1] !== g[g.length - 1][1])) g = [...g, g[0]];
    return g;
  });
  for (let r = 0; r < grid.length; r++) {
    if (grid[r].length < 4) return {code: 'ring_too_short', details: {path: [r], positions: grid[r].length}};
    if (grid[r].every(p => cross(grid[r][0], grid[r].find(q => q[0] !== grid[r][0][0] || q[1] !== grid[r][0][1]), p) === 0n)) return {code: 'ring_zero_area', details: {path: [r]}};
  }
  const segments = [];
  grid.forEach((ring, r) => { for (let i = 0; i + 1 < ring.length; i++) segments.push({r, i, a: ring[i], b: ring[i + 1], count: ring.length - 1}); });
  let self = null, across = null;
  for (let x = 0; x < segments.length; x++) for (let y = x + 1; y < segments.length; y++) {
    const s = segments[x], t = segments[y];
    let hit;
    if (s.r === t.r && (t.i - s.i === 1 || (s.i === 0 && t.i === s.count - 1))) {
      // Neighbours: first in ring order is "from", the other continues from the shared vertex.
      const [from, to] = t.i - s.i === 1 ? [s, t] : [t, s];
      const dot = (from.b[0] - from.a[0]) * (to.b[0] - to.a[0]) + (from.b[1] - from.a[1]) * (to.b[1] - to.a[1]);
      hit = cross(from.a, from.b, to.b) === 0n && dot < 0n;
    } else hit = segmentsShare(s.a, s.b, t.a, t.b);
    if (!hit) continue;
    const pair = [s.r, s.i, t.r, t.i];
    if (s.r === t.r) { if (!self) self = pair; } else if (!across) across = pair;
  }
  if (self) return {code: 'self_intersection', details: {ring: self[0], segments: [self[1], self[3]]}};
  if (across) return {code: 'rings_intersect', details: {rings: [across[0], across[2]], segments: [across[1], across[3]]}};
  for (let h = 1; h < grid.length; h++) {
    if (!insideRing(grid[h][0], grid[0])) return {code: 'invalid_hole', details: {ring: h, reason: 'outside_exterior'}};
    for (let k = 1; k < grid.length; k++) if (k !== h && insideRing(grid[h][0], grid[k])) return {code: 'invalid_hole', details: {ring: h, reason: 'inside_other_hole'}};
  }
  return {ok: true, rings: grid};
}

/** Every way a cleaned feature breaks the documented output rules. An empty list means it is clean. */
export function violations(feature, {precision = 6, fields}) {
  const bad = [];
  const need = (condition, text) => { if (!condition) bad.push(text); };
  need(feature.type === 'Feature' && /^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(feature.id), 'feature shell and id');
  need(JSON.stringify(Object.keys(feature.properties)) === JSON.stringify(fields), 'properties are exactly the fields, in order');
  need(Object.values(feature.properties).every(v => typeof v === 'string' && v === v.trim().replace(/\s+/g, ' ') && v !== ''), 'properties are tidy, non-empty text');
  const g = feature.geometry, grid = Math.pow(10, precision);
  need(['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(g.type), 'geometry type');
  const position = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90 &&
    p.every(v => !Object.is(v, -0) && Number(v.toFixed(precision)) === v && Math.abs(v * grid - Math.round(v * grid)) < 1e-3);
  const line = pts => { need(pts.length >= 2 && pts.every(position), 'line positions'); need(pts.every((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]), 'line has consecutive duplicates'); };
  const polygon = rings => {
    need(rings.every(ring => ring.length >= 4 && ring.every(position)), 'ring positions');
    need(rings.every(ring => ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]), 'ring closed');
    need(rings.every(ring => ring.every((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1])), 'ring has consecutive duplicates');
    if (bad.length) return;
    const verdict = judgePolygon(rings, precision);
    need(verdict.ok, 'polygon rule broken: ' + verdict.code + ' ' + JSON.stringify(verdict.details));
    if (verdict.ok) verdict.rings.forEach((ring, r) => need(areaSignExact(ring) === (r === 0 ? 1 : -1), 'ring ' + r + ' orientation'));
  };
  if (g.type === 'Point') need(position(g.coordinates), 'point position');
  else if (g.type === 'LineString') line(g.coordinates);
  else if (g.type === 'MultiLineString') { need(g.coordinates.length > 0, 'empty multiline'); g.coordinates.forEach(line); }
  else if (g.type === 'Polygon') polygon(g.coordinates);
  else if (g.type === 'MultiPolygon') { need(g.coordinates.length > 0, 'empty multipolygon'); g.coordinates.forEach(polygon); }
  return bad;
}
