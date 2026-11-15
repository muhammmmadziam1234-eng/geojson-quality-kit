// Types for geojson-quality-kit (index.mjs). Written by hand; test/types-check.ts compiles against this file.

export type GeometryType = 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon';
export type Severity = 'error' | 'warning';
export type IssueCode =
  | 'invalid_json' | 'invalid_feature' | 'invalid_id' | 'missing_property' | 'invalid_property_value' | 'duplicate_id'
  | 'null_geometry' | 'geometry_collection_unsupported' | 'unknown_geometry_type' | 'geometry_type_not_allowed'
  | 'invalid_coordinates' | 'coordinate_out_of_range' | 'empty_geometry' | 'line_too_short' | 'ring_too_short'
  | 'ring_zero_area' | 'self_intersection' | 'rings_intersect' | 'invalid_hole'
  | 'multipoint_exploded' | 'duplicate_positions' | 'ring_not_closed' | 'ring_orientation' | 'antimeridian_crossing';

/** [longitude, latitude] in WGS 84 degrees. Output positions never carry an altitude. */
export type Position = [longitude: number, latitude: number];
/** [west, south, east, north] */
export type BBox = [west: number, south: number, east: number, north: number];

export interface PointGeometry { type: 'Point'; coordinates: Position }
export interface LineStringGeometry { type: 'LineString'; coordinates: Position[] }
export interface MultiLineStringGeometry { type: 'MultiLineString'; coordinates: Position[][] }
export interface PolygonGeometry { type: 'Polygon'; coordinates: Position[][] }
export interface MultiPolygonGeometry { type: 'MultiPolygon'; coordinates: Position[][][] }
/** Geometries that can appear in cleaned output. MultiPoint inputs are exploded into Point features. */
export type CleanGeometry = PointGeometry | LineStringGeometry | MultiLineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

export interface CleanFeature<G extends CleanGeometry = CleanGeometry> {
  type: 'Feature';
  /** Trimmed, upper-cased id; unique within the output. */
  id: string;
  geometry: G;
  /** Exactly the configured fields, as trimmed text. */
  properties: Record<string, string>;
}
export interface CleanCollection<G extends CleanGeometry = CleanGeometry> {
  type: 'FeatureCollection';
  /** Present only when at least one feature was accepted. */
  bbox?: BBox;
  features: CleanFeature<G>[];
}

/** What the kit accepts as input: anything that claims to be a FeatureCollection. Features are checked one by one. */
export interface FeatureCollectionInput { type: 'FeatureCollection'; features: readonly unknown[] }

export interface FieldObject {
  name: string;
  /** How the text is normalised: kept as written (default), lower-cased or upper-cased. */
  case?: 'keep' | 'lower' | 'upper';
  /** Allowed values, compared after the case rule is applied. */
  oneOf?: readonly string[];
}
/** "name", "level:lower" or "level:lower=low|moderate|high". The name "id" copies the feature id into properties. */
export type FieldSpec = string | FieldObject;

export interface CleanOptions {
  /** Decimal places kept in coordinates, 0 to 8. Default 6. */
  precision?: number;
  /** Flag accepted points closer than this many metres, 0 to 1000; 0 turns the check off. Default 15. */
  nearMeters?: number;
  /** Geometry types to accept. Default: all supported types. */
  geometryTypes?: readonly GeometryType[];
  /** Properties that are required and kept. Default ["name", "category:lower"]. */
  fields?: readonly FieldSpec[];
  /** Property whose values are counted in report.categories. Default "category" when it is a field, else null. */
  groupBy?: string | null;
  /** Most entries kept in each report list (issues, warnings, nearby); counts stay exact. null = no limit. Default 10000. */
  maxItems?: number | null;
}

/** One finding. `details` depends on the code; see the README table. */
export interface Finding<S extends Severity = Severity> {
  code: IssueCode;
  severity: S;
  /** Human-readable and may change between versions; rely on code and details. */
  message: string;
  details: Record<string, unknown>;
}
/** A finding about one input feature. `index` is the zero-based position in the input; `id` is the id as written, or null. */
export interface ReportFinding<S extends Severity = Severity> extends Finding<S> { index: number; id: string | null }
export interface NearbyPair { ids: [string, string]; meters: number }

export interface ResolvedFieldOption { name: string; case: 'keep' | 'lower' | 'upper'; oneOf?: string[] }
export interface Report {
  schemaVersion: 2;
  tool: { name: string; version: string };
  options: {
    precision: number; nearMeters: number; geometryTypes: GeometryType[]; fields: ResolvedFieldOption[];
    groupBy: string | null; maxItems: number | null;
  };
  /** Features read. */
  input: number;
  /** Input features accepted; accepted + rejected = input. */
  accepted: number;
  rejected: number;
  /** Features written; larger than accepted when MultiPoints were exploded. */
  output: number;
  /** Copy of options.precision, kept so version 1 readers still work. */
  precision: number;
  /** Copy of options.nearMeters, kept so version 1 readers still work. */
  nearMeters: number;
  bbox: BBox | null;
  /** Output features by geometry type. */
  geometries: Record<string, number>;
  /** Output features by the groupBy property. */
  categories: Record<string, number>;
  nearby: NearbyPair[];
  counts: { errors: Partial<Record<IssueCode, number>>; warnings: Partial<Record<IssueCode, number>>; nearby: number };
  /** True when a list was cut at options.maxItems; the counts are always complete. */
  truncated: { issues: boolean; warnings: boolean; nearby: boolean };
  /** One entry per rejected feature: the first error found. */
  issues: ReportFinding<'error'>[];
  warnings: ReportFinding<'warning'>[];
}
export interface CleanResult { cleaned: CleanCollection; report: Report }

export interface ValidateOptions {
  /** Coordinates are evaluated rounded to this many decimals. Default 8. */
  precision?: number;
  geometryTypes?: readonly GeometryType[];
}
export interface ValidationResult {
  /** True when there is no error (warnings do not make a geometry invalid). */
  valid: boolean;
  /** The first error, or the warnings when valid. */
  issues: Finding[];
}

/** The original version 1 report written by cleanPoints. */
export interface LegacyReport {
  input: number; accepted: number; rejected: number; precision: number; bbox: BBox | null; nearMeters: number;
  nearby: NearbyPair[]; categories: Record<string, number>;
  issues: { index: number; id: string | null; reason: 'invalid_feature' | 'missing_or_invalid_fields' | 'invalid_point' | 'duplicate_id'; keptIndex?: number }[];
}

export interface IssueCodeInfo {
  severity: Severity;
  appliesTo: 'record' | 'feature' | 'geometry';
  summary: string;
  fix: string;
}

/** Cleans, validates and reports on every feature of a FeatureCollection without modifying it. */
export function cleanFeatures(collection: FeatureCollectionInput, options?: CleanOptions): CleanResult;
/** The original points-only cleaner, unchanged. Returns the version 1 report. */
export function cleanPoints(collection: FeatureCollectionInput, options?: { precision?: number; nearMeters?: number }): { cleaned: CleanCollection<PointGeometry>; report: LegacyReport };
/** Checks one geometry against the rules without modifying it. */
export function validateGeometry(geometry: unknown, options?: ValidateOptions): ValidationResult;
export const ISSUE_CODES: Readonly<Record<IssueCode, Readonly<IssueCodeInfo>>>;
export const VERSION: string;
