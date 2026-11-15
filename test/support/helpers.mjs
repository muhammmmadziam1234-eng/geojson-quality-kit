import {readFile} from 'node:fs/promises';
export const root = new URL('../../', import.meta.url);
export const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
export const clone = value => JSON.parse(JSON.stringify(value));
export const collection = features => ({type: 'FeatureCollection', features});
export const feature = (id, geometry, properties = {name: 'N ' + id, category: 'c'}) => ({type: 'Feature', id, geometry, properties});
export const point = (id, coordinates, properties) => feature(id, {type: 'Point', coordinates}, properties);
