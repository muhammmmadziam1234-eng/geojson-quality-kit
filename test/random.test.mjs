import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanFeatures, cleanPoints, validateGeometry} from '../index.mjs';
import {orient, segmentsIntersect, areaSign} from '../lib/predicates.mjs';
import {rng} from './support/rng.mjs';
import {judgePolygon, violations, segmentsShare, orientSign, areaSignExact} from './support/oracle.mjs';
import {deepFreeze, collection, feature, point} from './support/helpers.mjs';

const SEED = 7_654_321;
const FIELDS = ['name', 'category'];

// ---- random messy collections -------------------------------------------------------------------
function position(r) {
  const roll = r.next();
  if (roll < 0.03) return [r.float(180.1, 400), r.float(-90, 90)];
  if (roll < 0.05) return [1];
  if (roll < 0.06) return ['x', 2];
  return [r.float(-180, 180), r.float(-90, 90), ...(r.chance(0.1) ? [r.float(0, 500)] : [])];
}
function ring(r, cx, cy, radius) {
  const n = r.int(3, 9);
  const pts = Array.from({length: n}, (_, k) => { const a = (k + r.float(-0.3, 0.3)) * 2 * Math.PI / n; return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)]; });
  if (r.chance(0.1)) { const k = r.int(0, n - 2); [pts[k], pts[k + 1]] = [pts[k + 1], pts[k]]; }
  const closed = [...pts, pts[0]];
  if (r.chance(0.5)) closed.reverse();
  if (r.chance(0.2)) closed.pop();
  if (r.chance(0.2)) closed.splice(r.int(0, closed.length), 0, closed[r.int(0, closed.length - 1)]);
  if (r.chance(0.02)) closed[0] = [999, 0];
  return closed;
}
function polygon(r) {
  const cx = r.float(-170, 170), cy = r.float(-80, 80), radius = r.float(0.001, 5);
  const rings = [ring(r, cx, cy, radius)];
  if (r.chance(0.25)) rings.push(ring(r, cx, cy, radius * 0.3));
  if (r.chance(0.05)) rings.push(ring(r, cx, cy, radius * 3));
  return rings;
}
const line = r => Array.from({length: r.int(0, 5)}, () => position(r)).flatMap(p => (r.chance(0.2) ? [p, p] : [p]));
function geometry(r) {
  const roll = r.next();
  if (roll < 0.02) return null;
  if (roll < 0.04) return {type: 'GeometryCollection', geometries: []};
  if (roll < 0.06) return {type: 'Wat', coordinates: []};
  if (roll < 0.35) return {type: 'Point', coordinates: position(r)};
  if (roll < 0.43) return {type: 'MultiPoint', coordinates: Array.from({length: r.int(0, 3)}, () => position(r))};
  if (roll < 0.55) return {type: 'LineString', coordinates: line(r)};
  if (roll < 0.60) return {type: 'MultiLineString', coordinates: [line(r), line(r)]};
  if (roll < 0.88) return {type: 'Polygon', coordinates: polygon(r)};
  return {type: 'MultiPolygon', coordinates: [polygon(r), polygon(r)]};
}
const POOL = Array.from({length: 70}, (_, i) => 'id' + i);
function randomFeature(r) {
  if (r.chance(0.02)) return r.pick([null, 'text', 5, [1]]);
  const roll = r.next(), base = r.pick(POOL);
  const id = roll < 0.04 ? undefined : roll < 0.06 ? 12 : roll < 0.08 ? '  ' : r.pick([base, base.toUpperCase(), ' ' + base + ' ']);
  const properties = {name: r.pick([' North  Gate ', 'x', '', undefined, 7]), category: r.pick(['Health', ' CLINIC ', 'park', '', undefined])};
  if (r.chance(0.1)) properties.id = r.pick(POOL);
  return {type: 'Feature', ...(id === undefined ? {} : {id}), properties: r.chance(0.02) ? null : properties, geometry: geometry(r)};
}
const randomCollection = r => collection(Array.from({length: 40}, () => randomFeature(r)));
const cases = (count, build) => { const r = rng(SEED); return Array.from({length: count}, () => build(r)); };

const tidy = s => s.trim().replace(/\s+/g, ' ');
// What the output ids should be, worked out from the input alone.
function expectedIds(input, report) {
  const rejected = new Set(report.issues.map(x => x.index));
  return input.features.flatMap((f, i) => {
    if (rejected.has(i)) return [];
    const rawId = [f.id, f.properties.id].find(v => typeof v === 'string' && v.trim() !== '');
    const id = tidy(rawId).toUpperCase();
    return f.geometry.type === 'MultiPoint' ? f.geometry.coordinates.map((_, k) => id + '-' + (k + 1)) : [id];
  });
}

test('random collections: cleaning twice equals cleaning once', () => {
  for (const input of cases(300, randomCollection)) {
    const once = cleanFeatures(input);
    const twice = cleanFeatures(once.cleaned);
    assert.deepEqual(twice.cleaned, once.cleaned);
    assert.equal(twice.report.rejected, 0, JSON.stringify(twice.report.issues[0]));
    assert.ok(Object.keys(twice.report.counts.warnings).every(code => code === 'antimeridian_crossing'), JSON.stringify(twice.report.counts.warnings));
  }
});

test('random collections: the same input always gives the same output, and the input is never touched', () => {
  for (const input of cases(120, randomCollection)) {
    const text = JSON.stringify(input);
    const a = cleanFeatures(deepFreeze(input)), b = cleanFeatures(JSON.parse(text));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(JSON.stringify(input), text);
  }
});

test('random collections: accepted features keep the input order and ids stay unique', () => {
  for (const input of cases(300, randomCollection)) {
    const {cleaned, report} = cleanFeatures(input);
    const ids = cleaned.features.map(f => f.id);
    assert.deepEqual(ids, expectedIds(input, report));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(report.accepted + report.rejected, input.features.length);
    assert.equal(report.output, ids.length);
  }
});

test('random collections: no accepted feature breaks a rule, judged by an independent checker', () => {
  let checked = 0;
  for (const input of cases(300, randomCollection)) {
    const {cleaned, report} = cleanFeatures(input);
    for (const f of cleaned.features) { assert.deepEqual(violations(f, {fields: FIELDS}), [], JSON.stringify(f).slice(0, 300)); checked++; }
    const all = cleaned.features.flatMap(f => (f.geometry.type === 'Point' ? [f.geometry.coordinates] : []));
    if (cleaned.features.length) {
      const xs = cleaned.features.flatMap(f => JSON.stringify(f.geometry.coordinates).match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0));
      assert.equal(report.bbox[0], Math.min(...xs));
      assert.equal(report.bbox[2], Math.max(...xs));
    }
    void all;
  }
  assert.ok(checked > 1000, 'checked ' + checked + ' accepted features');
});

test('random collections: validateGeometry agrees with cleanFeatures on every geometry', () => {
  const r = rng(SEED + 1);
  for (let i = 0; i < 1500; i++) {
    const g = geometry(r);
    const verdict = validateGeometry(g, {precision: 6});
    const {report} = cleanFeatures(collection([feature('a', g, {name: 'n', category: 'c'})]), {nearMeters: 0});
    if (verdict.valid) { assert.equal(report.accepted, 1); assert.deepEqual(report.warnings.map(w => w.code).filter(c => c !== 'multipoint_exploded'), verdict.issues.map(x => x.code)); }
    else { assert.equal(report.rejected, 1); assert.equal(report.issues[0].code, verdict.issues[0].code); assert.deepEqual(report.issues[0].details, verdict.issues[0].details); }
  }
});

// ---- polygons against the brute-force checker --------------------------------------------------
const intRing = (r, size) => {
  for (;;) {
    const pts = Array.from({length: r.int(3, 7)}, () => [r.int(0, size), r.int(0, size)]);
    if (r.chance(0.1)) pts.push(...pts.slice(0, 2).map(([x]) => [x, pts[0][1]]));       // some flat shapes
    const closed = [...pts, pts[0]];
    if (closed.every((p, i) => i === 0 || p[0] !== closed[i - 1][0] || p[1] !== closed[i - 1][1])) return closed;
  }
};
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];

test('polygons: accept and reject exactly where the brute-force checker does, with the same segment indices', () => {
  const r = rng(SEED + 2), seen = {};
  for (let i = 0; i < 9000; i++) {
    const kind = i % 3;
    const rings = kind === 0 ? [r.chance(0.1) ? [[1, 1], [r.int(1, 3), r.int(1, 3)], [1, 1]] : intRing(r, 6)]
      : kind === 1 ? [intRing(r, 6), ...(r.chance(0.5) ? [intRing(r, 6)] : [])]
        : [box(0, 0, 12, 12), ...Array.from({length: r.int(1, 3)}, () => r.pick([
          () => box(r.int(-2, 12), r.int(-2, 12), r.int(1, 4), r.int(1, 4)), () => intRing(r, 12), () => box(r.int(14, 20), r.int(14, 20), 2, 2), () => box(2, 2, 8, 8), () => box(r.int(3, 8), r.int(3, 8), 1, 1)
        ])())];
    const verdict = judgePolygon(rings);
    const {report, cleaned} = cleanFeatures(collection([feature('a', {type: 'Polygon', coordinates: rings})]), {nearMeters: 0});
    const tag = verdict.ok ? 'ok' : verdict.code;
    seen[tag] = (seen[tag] ?? 0) + 1;
    if (verdict.ok) {
      assert.equal(report.accepted, 1, JSON.stringify(rings) + ' ' + JSON.stringify(report.issues));
      assert.deepEqual(violations(cleaned.features[0], {fields: FIELDS}), []);
    } else {
      assert.equal(report.rejected, 1, 'should reject ' + verdict.code + ' ' + JSON.stringify(rings));
      assert.equal(report.issues[0].code, verdict.code, JSON.stringify(rings));
      assert.deepEqual(report.issues[0].details, verdict.details, JSON.stringify(rings));
    }
  }
  for (const code of ['ok', 'ring_too_short', 'ring_zero_area', 'self_intersection', 'rings_intersect', 'invalid_hole']) assert.ok(seen[code] > 50, code + ' was only generated ' + (seen[code] ?? 0) + ' times');
});

// ---- the predicates against exact arithmetic ---------------------------------------------------
test('predicates: orientation, segment intersection and area sign match BigInt arithmetic', () => {
  const r = rng(SEED + 3);
  const big = ([x, y]) => [BigInt(x), BigInt(y)];
  for (let i = 0; i < 20000; i++) {
    const span = r.pick([3, 40, 2 ** 24, 1.8e10]);                     // tiny grids, ordinary, and near the limit of exact doubles
    const pt = () => [Math.round(r.float(-span, span)), Math.round(r.float(-span, span))];
    const [a, b, c, d] = [pt(), pt(), pt(), pt()];
    assert.equal(orient(...a, ...b, ...c), orientSign(big(a), big(b), big(c)));
    if (span <= 40) assert.equal(segmentsIntersect(...a, ...b, ...c, ...d), segmentsShare(big(a), big(b), big(c), big(d)));
    // a nearly straight triple: the third point is the exact midpoint, moved by at most one unit
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Number.isInteger(m[0]) && Number.isInteger(m[1])) {
      const nudged = [m[0] + r.int(-1, 1), m[1] + r.int(-1, 1)];
      assert.equal(orient(...a, ...b, ...nudged), orientSign(big(a), big(b), big(nudged)));
    }
  }
  for (let i = 0; i < 3000; i++) {
    const span = r.pick([5, 2 ** 26, 1.8e10]);
    const pts = Array.from({length: r.int(3, 12)}, () => [Math.round(r.float(-span, span)), Math.round(r.float(-span, span))]);
    const closed = [...pts, pts[0]];
    assert.equal(areaSign(closed.map(p => p[0]), closed.map(p => p[1])), areaSignExact(closed.map(big)));
  }
});

// ---- the new engine against the original point cleaner -----------------------------------------
test('points: cleanFeatures restricted to points matches the original cleanPoints on random input', () => {
  const r = rng(SEED + 4), LEGACY = {missing_or_invalid_fields: ['invalid_id', 'missing_property'], invalid_point: ['null_geometry', 'geometry_collection_unsupported', 'unknown_geometry_type', 'geometry_type_not_allowed', 'invalid_coordinates', 'coordinate_out_of_range'], duplicate_id: ['duplicate_id'], invalid_feature: ['invalid_feature']};
  const letters = 'ABCDEFGHIJ012', word = n => Array.from({length: n}, () => r.pick([...'abcdefghij'])).join('');
  for (let round = 0; round < 200; round++) {
    const features = Array.from({length: 40}, () => {
      const roll = r.next();
      if (roll < 0.03) return r.pick([null, 'x', {type: 'Feature'}]);
      const id = r.chance(0.05) ? undefined : r.pick(['', ' ']) + Array.from({length: r.int(1, 2)}, () => r.pick([...letters])).join('') + r.pick(['', ' ']);
      const g = roll < 0.06 ? null : roll < 0.1 ? {type: 'LineString', coordinates: [[0, 0], [1, 1]]} : {type: 'Point', coordinates: r.chance(0.08) ? [r.float(181, 300), 5] : r.chance(0.04) ? [1] : [r.float(79.9, 79.91), r.float(6.9, 6.91), ...(r.chance(0.2) ? [12] : [])]};
      return {type: 'Feature', ...(id === undefined ? {} : {id: r.chance(0.2) ? 3 : id}), properties: {name: r.pick(['Gate', ' Gate  one ', '', undefined]), category: r.pick([word(3), ' ' + word(2).toUpperCase(), ''])}, geometry: g};
    });
    const input = collection(features), options = {nearMeters: r.pick([0, 15, 40]), precision: r.int(0, 8)};
    const legacy = cleanPoints(input, options), next = cleanFeatures(input, {...options, geometryTypes: ['Point']});
    assert.deepEqual(next.cleaned, legacy.cleaned);
    for (const key of ['input', 'accepted', 'rejected', 'precision', 'bbox', 'nearMeters', 'nearby', 'categories']) assert.deepEqual(next.report[key], legacy.report[key], key);
    assert.equal(next.report.issues.length, legacy.report.issues.length);
    next.report.issues.forEach((issue, k) => {
      const old = legacy.report.issues[k];
      assert.deepEqual([issue.index, issue.id], [old.index, old.id]);
      assert.ok(LEGACY[old.reason].includes(issue.code), old.reason + ' vs ' + issue.code);
      assert.equal(issue.details.keptIndex, old.keptIndex);
    });
  }
});

test('points: a million-point style spread does not confuse the proximity sweep (against brute force)', () => {
  const r = rng(SEED + 5);
  for (let round = 0; round < 40; round++) {
    const pts = Array.from({length: 60}, (_, i) => point('p' + i, [r.float(-0.0005, 0.0005) + r.pick([0, 179.9995, -179.9995]), r.float(-0.0004, 0.0004)]));
    const radius = r.pick([5, 15, 40]);
    const {report} = cleanFeatures(collection(pts), {nearMeters: radius, maxItems: null});
    const R = 6371008.8, rad = d => d * Math.PI / 180;
    const expected = [];
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
      const [p, q] = [pts[a].geometry.coordinates, pts[b].geometry.coordinates];
      const h = Math.sin(rad(q[1] - p[1]) / 2) ** 2 + Math.cos(rad(p[1])) * Math.cos(rad(q[1])) * Math.sin(rad(q[0] - p[0]) / 2) ** 2;
      const meters = 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
      if (meters <= radius) expected.push([pts[a].id.toUpperCase(), pts[b].id.toUpperCase()].sort().join('|'));
    }
    assert.deepEqual(report.nearby.map(x => x.ids.join('|')).sort(), expected.sort());
    assert.equal(report.counts.nearby, expected.length);
  }
});
