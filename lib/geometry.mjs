import {isObject} from './util.mjs';
import {GEOMETRY_TYPES} from './options.mjs';
import {makeFinding} from './codes.mjs';

const RFC_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

export function makeConfig({precision = 6, geometryTypes = GEOMETRY_TYPES} = {}) {
  return {precision, allowedList: geometryTypes, allowed: new Set(geometryTypes), round: n => Number(n.toFixed(precision)) || 0};
}

const fail = (code, details = {}) => ({error: {code, details}});

function badPosition(p) {
  if (!Array.isArray(p)) return 'expected an array of numbers';
  if (p.length !== 2 && p.length !== 3) return 'expected 2 or 3 numbers, found ' + p.length;
  return 'a value is not a finite number';
}
// [longitude, latitude] with an optional altitude, which is accepted and dropped.
function checkPosition(p, path) {
  if (!Array.isArray(p) || (p.length !== 2 && p.length !== 3) || !p.every(Number.isFinite))
    return {code: 'invalid_coordinates', details: {path, problem: badPosition(p)}};
  if (Math.abs(p[0]) > 180) return {code: 'coordinate_out_of_range', details: {path, axis: 'longitude', value: p[0]}};
  if (Math.abs(p[1]) > 90) return {code: 'coordinate_out_of_range', details: {path, axis: 'latitude', value: p[1]}};
  return null;
}

// Checks one geometry against the rules and returns either {error} (the first error found) or
// {geometries, sources, warnings}: the cleaned geometry (several for an exploded MultiPoint),
// the original positions of any points, and the warnings. The input is never modified.
export function analyzeGeometry(g, cfg) {
  if (g === null || g === undefined) return fail('null_geometry');
  if (!isObject(g) || typeof g.type !== 'string') return fail('unknown_geometry_type', {type: null});
  if (g.type === 'GeometryCollection') return fail('geometry_collection_unsupported');
  if (!RFC_TYPES.includes(g.type)) return fail('unknown_geometry_type', {type: g.type.slice(0, 40)});
  if (!cfg.allowed.has(g.type)) return fail('geometry_type_not_allowed', {type: g.type, allowed: cfg.allowedList});
  const bad = checkPosition(g.coordinates, []);
  if (bad) return {error: bad};
  const [lon, lat] = g.coordinates;
  return {geometries: [{type: 'Point', coordinates: [cfg.round(lon), cfg.round(lat)]}], sources: [[lon, lat]], warnings: []};
}

// Reports what the cleaner would find in one geometry, as it is written (rounded to `precision`
// decimals, default 8). Stops at the first error. `valid` is true when there is no error.
export function validateGeometry(geometry, options) {
  if (options === undefined) options = {};
  if (!isObject(options)) throw new TypeError('Options must be an object.');
  for (const key of Object.keys(options))
    if (key !== 'precision' && key !== 'geometryTypes') throw new TypeError('Unknown option "' + key + '". Known options: precision, geometryTypes.');
  const {precision = 8, geometryTypes = GEOMETRY_TYPES} = options;
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new RangeError('Precision must be an integer from 0 to 8.');
  if (!Array.isArray(geometryTypes) || !geometryTypes.length || !geometryTypes.every(t => GEOMETRY_TYPES.includes(t)))
    throw new RangeError('geometryTypes must be a non-empty list of: ' + GEOMETRY_TYPES.join(', ') + '.');
  const result = analyzeGeometry(geometry, makeConfig({precision, geometryTypes: GEOMETRY_TYPES.filter(t => geometryTypes.includes(t))}));
  if (result.error) return {valid: false, issues: [makeFinding(result.error.code, result.error.details)]};
  return {valid: true, issues: result.warnings.map(x => makeFinding(x.code, x.details))};
}
