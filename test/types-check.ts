// Compiled by `npm run types` (tsc --noEmit). It imports from the package name, so it also
// proves that package.json "exports" and "types" point at index.d.ts. A line that follows an
// expect-error comment must NOT compile; if one starts compiling, tsc reports the unused comment.
import {
  cleanFeatures, cleanPoints, validateGeometry, ISSUE_CODES, VERSION,
  type CleanOptions, type Report, type IssueCode, type CleanFeature, type GeometryType, type FeatureCollectionInput
} from 'geojson-quality-kit';

const empty: FeatureCollectionInput = {type: 'FeatureCollection', features: []};
const options: CleanOptions = {
  precision: 5, nearMeters: 10, geometryTypes: ['Point', 'Polygon'],
  fields: ['name', 'level:lower=low|moderate|high', {name: 'category', case: 'lower', oneOf: ['park']}],
  groupBy: 'category', maxItems: null
};
const result = cleanFeatures(empty, options);
const report: Report = result.report;

const version: string = VERSION;
const schemaVersion: 2 = report.schemaVersion;
const bbox: [number, number, number, number] | null = report.bbox;
const accepted: number = report.accepted + report.rejected + report.output;
const coverage: Record<string, number> = {...report.categories, ...report.geometries};

const issue = report.issues[0];
if (issue) {
  const code: IssueCode = issue.code;
  const severity: 'error' = issue.severity;
  const index: number = issue.index;
  const id: string | null = issue.id;
  const details: Record<string, unknown> = issue.details;
  void [code, severity, index, id, details];
}
const warning = report.warnings[0];
if (warning) { const severity: 'warning' = warning.severity; void severity; }
const pair = report.nearby[0];
if (pair) { const [a, b]: [string, string] = pair.ids; void [a, b, pair.meters]; }
const codeCount: number | undefined = report.counts.errors.duplicate_id;
const cut: boolean = report.truncated.issues;

for (const feature of result.cleaned.features) {
  const f: CleanFeature = feature;
  if (f.geometry.type === 'Polygon') { const ring: [number, number][] | undefined = f.geometry.coordinates[0]; void ring; }
  else if (f.geometry.type === 'Point') { const [lon, lat]: [number, number] = f.geometry.coordinates; void [lon, lat]; }
  const text: string | undefined = f.properties.name;
  void [f.id, text];
}
const west: number | undefined = result.cleaned.bbox?.[0];

const legacy = cleanPoints(empty, {precision: 4});
const firstLegacy = legacy.report.issues[0];
if (firstLegacy) { const reason: 'invalid_feature' | 'missing_or_invalid_fields' | 'invalid_point' | 'duplicate_id' = firstLegacy.reason; void reason; }
const pointOnly: [number, number] | undefined = legacy.cleaned.features[0]?.geometry.coordinates;

const verdict = validateGeometry({type: 'Point', coordinates: [1, 2]}, {precision: 6, geometryTypes: ['Point'] satisfies GeometryType[]});
const valid: boolean = verdict.valid;
const first = verdict.issues[0];
if (first) { const s: 'error' | 'warning' = first.severity; void s; }
const info = ISSUE_CODES.self_intersection;
const infoSeverity: 'error' | 'warning' = info.severity;
const applies: 'record' | 'feature' | 'geometry' = info.appliesTo;

// @ts-expect-error an unknown option is a compile error
cleanFeatures(empty, {nearMeter: 5});
// @ts-expect-error precision is a number
cleanFeatures(empty, {precision: '6'});
// @ts-expect-error a single Feature is not a FeatureCollection
cleanFeatures({type: 'Feature'});
// @ts-expect-error Circle is not a geometry type
cleanFeatures(empty, {geometryTypes: ['Circle']});
// @ts-expect-error codes are a closed set
const madeUp: IssueCode = 'made_up';
// @ts-expect-error the report cannot be reassigned to another schema version
const wrongVersion: 1 = report.schemaVersion;
// @ts-expect-error validateGeometry takes its options as an object
validateGeometry({type: 'Point', coordinates: [1, 2]}, 6);

void [version, schemaVersion, bbox, accepted, coverage, codeCount, cut, west, pointOnly, valid, infoSeverity, applies, madeUp, wrongVersion];
