import {feature} from './helpers.mjs';

export const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
// MultiPolygon is left out on purpose so that it triggers geometry_type_not_allowed.
export const EVERY_RULE_OPTIONS = {
  geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon'],
  fields: ['name', 'category:lower=park|school|clinic']
};
const f = (id, geometry, category = 'park') => feature(id, geometry, {name: ' ' + id + '  site ', category});

// One feature for every error code except invalid_json (NDJSON only), then features that are
// accepted with warnings, and a few plain ones. Every code in lib/codes.mjs is hit by this list.
export function everyRule() {
  return {type: 'FeatureCollection', features: [
    f('ok-point', {type: 'Point', coordinates: [79.9, 6.9, 12]}),
    'not a feature',
    {type: 'Feature', properties: {name: 'No id', category: 'park'}, geometry: {type: 'Point', coordinates: [1, 1]}},
    feature('blank-name', {type: 'Point', coordinates: [1, 1]}, {name: '  ', category: 'park'}),
    f('bad-category', {type: 'Point', coordinates: [2, 2]}, 'casino'),
    f('OK-POINT', {type: 'Point', coordinates: [3, 3]}),
    f('no-geometry', null),
    f('collection', {type: 'GeometryCollection', geometries: []}),
    f('unknown-type', {type: 'Circle', coordinates: [1, 1], radius: 5}),
    f('not-allowed', {type: 'MultiPolygon', coordinates: [[square(0, 0, 1)]]}),
    f('short-position', {type: 'Point', coordinates: [5]}),
    f('far-east', {type: 'Point', coordinates: [181.3, 6.92]}),
    f('empty-line', {type: 'LineString', coordinates: []}),
    f('one-spot', {type: 'LineString', coordinates: [[1, 1], [1, 1]]}),
    f('flat-ring', {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]]}),
    f('no-area', {type: 'Polygon', coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]]}),
    f('bow-tie', {type: 'Polygon', coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]}),
    f('hole-crosses', {type: 'Polygon', coordinates: [square(0, 0, 10), [[8, 2], [12, 2], [12, 4], [8, 4], [8, 2]]]}),
    f('hole-outside', {type: 'Polygon', coordinates: [square(0, 0, 10), [[20, 20], [20, 21], [21, 21], [21, 20], [20, 20]]]}),
    f('multi', {type: 'MultiPoint', coordinates: [[10, 10], [10.00004, 10]]}),
    f('doubled', {type: 'LineString', coordinates: [[0, 0], [0, 0], [1, 1]]}),
    f('open-ring', {type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4]]]}),
    f('clockwise', {type: 'Polygon', coordinates: [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]]}),
    f('dateline', {type: 'LineString', coordinates: [[179, 0], [-179, 0]]}),
    f('lake', {type: 'Polygon', coordinates: [square(20, 20, 10), [[22, 22], [22, 24], [24, 24], [24, 22], [22, 22]]]}),
    f('islands', {type: 'MultiLineString', coordinates: [[[30, 30], [31, 31]], [[32, 32], [33, 33]]]}),
    f('near-a', {type: 'Point', coordinates: [40, 40]}),
    f('near-b', {type: 'Point', coordinates: [40.00005, 40]})
  ]};
}
