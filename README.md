# GeoJSON Quality Kit

[![Tests](https://github.com/muhammmmadziam1234-eng/geojson-quality-kit/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/muhammmmadziam1234-eng/geojson-quality-kit/actions/workflows/test.yml)

A data-quality tool for GeoJSON features. It checks Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon features against explicit rules, fixes what has one safe fix (rounding, duplicate vertices, ring closing, winding order), rejects what it cannot fix with a stable code and the offending indices, and writes a machine-readable report. It started as a 70-line script that cleaned a facility inventory; it is now a typed library, a command line and an NDJSON streaming path, with no runtime dependencies.

| | |
| --- | --- |
| Interfaces | Library (`index.mjs`, hand-written `index.d.ts`), command line (`geojson-quality`), NDJSON streaming |
| Report | Versioned and described by [report.schema.json](report.schema.json) (JSON Schema 2020-12) |
| Tests | 92 tests, 99.74% of lines covered ([evidence](docs/evidence/coverage.txt)); golden files, seeded random tests checked against a brute-force exact checker, command line, types, a real browser |
| Scale | 1,050,000 records (1,000,000 points and 50,000 polygons) cleaned in 12.81 s, peak memory 274 MB ([evidence](docs/evidence/benchmark.json)) |
| Companion | Prepares zones and facilities for [flood-exposure-atlas](#recipe-prepare-zones-and-facilities-for-flood-exposure-atlas); the atlas's own validator accepts the output |

## Why data quality matters here

Facility lists and flood-zone layers arrive from several exports, and their faults rarely fail loudly: a repeated id, a longitude typed as 181, or a polygon that crosses itself still loads, and the spatial join or area calculation that follows is quietly wrong. The kit turns each of those faults into a named, counted finding with the index of the input feature, so the data can be fixed at the source or excluded on purpose before anything is computed from it.

## Install and use

Requires Node.js 22 or later. Running the kit needs no packages. `npm ci` installs only the tools used by the tests (`ajv`, `playwright-core`, `typescript`). The package is private and not published to npm: use it from a clone, or `npm install /path/to/geojson-quality-kit` to get the `geojson-quality` command and the package import.

~~~sh
node cli.mjs examples/messy.geojson output --near 15
~~~

~~~text
Accepted 8 of 18 features; rejected 10; 6 warnings. Wrote 9 features.
output/clean.geojson
output/report.json
~~~

`geojson-quality INPUT [OUTPUT_DIR] [options]` reads a GeoJSON FeatureCollection (or `-` for standard input) and writes `clean.geojson` and `report.json` to OUTPUT_DIR. Without OUTPUT_DIR the cleaned data goes to standard output and the summary to standard error.

| Option | Meaning |
| --- | --- |
| `--precision N` | Decimals kept in coordinates, 0 to 8 (default 6, about 11 cm at the equator). |
| `--near METRES` | Flag accepted points closer than this, 0 to 1000; 0 turns it off (default 15). |
| `--types LIST` | Geometry types to accept, comma separated (default: all six). |
| `--fields LIST` | Required properties to keep, for example `name,level:lower=low\|moderate\|high` (default `name,category:lower`). `:lower` and `:upper` change the case; `=a\|b` lists the allowed values; the name `id` copies the feature id into the properties. |
| `--group-by NAME` | Property counted in `report.categories`, or `none` (default `category`). |
| `--format F` | `geojson` (default) or `ndjson`, for the cleaned file. |
| `--ndjson` | Read INPUT as one Feature per line. Also detected from a `.ndjson` or `.jsonl` name. |
| `--max-items N` | Entries kept in each report list, or `all` (default 10000). The counts stay exact. |
| `--report-only` | Write only the report. |
| `--strict` | Exit with 1 when any feature was rejected. |
| `--quiet` | Print nothing when the run succeeds. |
| `--help`, `--version` | |

Exit codes: 0 done, 1 features were rejected and `--strict` was given, 2 usage error, 3 input unreadable or not GeoJSON. Messages say what is wrong and how to fix it, for example a JSON syntax error reports the line and column, and a single Feature where a FeatureCollection is needed says how to wrap it. The command never overwrites its input.

The original form `node cli.mjs INPUT OUTPUT [PRECISION] [NEAR]`, with no options, still runs the original points-only cleaner and writes the original version 1 files and messages, byte for byte (a test compares it with `sample/example-report.json`). Adding any option, a `-` input, or an input ending in `.ndjson` or `.jsonl` selects the full tool.

From code:

~~~js
import {cleanFeatures} from './index.mjs'; // 'geojson-quality-kit' when installed

const {cleaned, report} = cleanFeatures(featureCollection, {precision: 6, nearMeters: 15});
// cleaned: a FeatureCollection; report: see "The report". The input is never modified.
~~~

`index.mjs` exports `cleanFeatures`, `cleanText(jsonString, options)` (parses a string and cleans it; returns `{cleaned, report}`, or `{error}` with the line and column of a JSON syntax error, or when the JSON is not a FeatureCollection), `validateGeometry` (the findings for one geometry, without cleaning), `cleanPoints` (the original function, unchanged), `ISSUE_CODES` and `VERSION`; [index.d.ts](index.d.ts) types all of them and `npm run types` compiles a consumer file against it.

## What it checks

Every finding has a stable code. Errors reject the feature; warnings never do. A rejected feature produces exactly one issue, the first error found, in this order: record (NDJSON line parses), feature shell, id, required properties in the order given, then geometry (type, then the whole coordinates structure, then per ring length and area, then crossings, then holes), and last the duplicate-id check. Rules run on coordinates after rounding, so cleaning twice gives the same result as cleaning once.

<!-- codes:start -->
| Code | Severity | Applies to | Meaning | Details | What to do |
| --- | --- | --- | --- | --- | --- |
| `invalid_json` | error | record | An NDJSON line is not valid JSON. | `line`, `column`, `message` | Fix the syntax on that line; the details give its line number in the file. |
| `invalid_feature` | error | feature | The record is not a Feature object with a properties object. | none | Write it as {"type":"Feature","geometry":{...},"properties":{...}}. |
| `invalid_id` | error | feature | No usable id in id or properties.id. | `reason` (only for a MultiPoint id that is too long to number) | Use 1 to 40 letters, digits, "_" or "-", not starting with "_" or "-". |
| `missing_property` | error | feature | A required property is missing or blank. | `property` | Add a text value for the property named in the details. |
| `invalid_property_value` | error | feature | A property is not one of the allowed values. | `property`, `value`, `allowed` | Use one of the values listed in the details. |
| `duplicate_id` | error | feature | The id was already used by an earlier accepted feature. | `keptIndex`, `id` | Give each feature its own id; the first one is kept. |
| `null_geometry` | error | geometry | The geometry is null or missing. | none | Add a geometry, or drop the record. |
| `geometry_collection_unsupported` | error | geometry | GeometryCollection is not supported. | none | Split it into one feature per member geometry. |
| `unknown_geometry_type` | error | geometry | The geometry type is not a GeoJSON geometry type. | `type` | Use Point, MultiPoint, LineString, MultiLineString, Polygon or MultiPolygon. |
| `geometry_type_not_allowed` | error | geometry | The geometry type is excluded by the geometryTypes option. | `type`, `allowed` | Allow the type, or send this feature to a different output. |
| `invalid_coordinates` | error | geometry | Coordinates are missing, nested wrongly, or a position is not 2 or 3 finite numbers. | `path`, `problem` | Write positions as [longitude, latitude] or [longitude, latitude, altitude]. |
| `coordinate_out_of_range` | error | geometry | Longitude is outside -180 to 180 or latitude outside -90 to 90. | `path`, `axis`, `value` | Check the axis order (longitude first) and the coordinate system (WGS 84 degrees). |
| `empty_geometry` | error | geometry | A coordinates array that must hold positions is empty. | `path` | Add the positions, or drop the feature. |
| `line_too_short` | error | geometry | A line has fewer than 2 distinct positions after rounding. | `path`, `distinct` | Add a second, different position, or use a Point. |
| `ring_too_short` | error | geometry | A polygon ring has fewer than 4 positions after cleaning. | `path`, `positions` | A ring needs at least 3 different corners, closed by repeating the first. |
| `ring_zero_area` | error | geometry | All positions of a polygon ring lie on one line (or collapse to one point when rounded). | `path` | Fix the corners, or raise the precision if the polygon really is that small. |
| `self_intersection` | error | geometry | Two segments of one ring cross, touch or overlap. | `polygon?`, `ring`, `segments` | Redraw the ring; the details give the two segment indices in the input ring. |
| `rings_intersect` | error | geometry | Two rings of one polygon share a point. | `polygon?`, `rings`, `segments` | Move the hole away from the exterior ring and from other holes. |
| `invalid_hole` | error | geometry | A hole lies outside the exterior ring, or inside another hole. | `polygon?`, `ring`, `reason` | Move the hole inside the exterior ring, or make it a separate polygon. |
| `multipoint_exploded` | warning | geometry | A MultiPoint was split into one Point feature per position. | `count`, `ids` | None needed. Output ids are the input id plus -1, -2, and so on. |
| `duplicate_positions` | warning | geometry | Consecutive duplicate positions were removed. | `count`, `at` | None needed; remove them at the source to silence the warning. |
| `ring_not_closed` | warning | geometry | A ring did not end where it started; the first position was appended. | `count`, `at` | Repeat the first position at the end of each ring. |
| `ring_orientation` | warning | geometry | An exterior ring ran clockwise or a hole counter-clockwise; it was reversed. | `count`, `at` | RFC 7946 wants exterior rings counter-clockwise and holes clockwise. |
| `antimeridian_crossing` | warning | geometry | A segment spans more than 180 degrees of longitude, so it probably crosses the antimeridian. | `count`, `at` | Kept as written. Split the geometry at 180 degrees if the consumer needs it (RFC 7946 section 3.1.9). |
<!-- codes:end -->

Details that the table cannot hold:

- Ids come from the feature's own `id`, or from `properties.id` when the feature has no text id. They are trimmed, upper-cased and must match `[A-Z0-9][A-Z0-9_-]{0,39}`. A MultiPoint becomes Points with the ids `ID-1`, `ID-2`, and also reserves `ID`.
- Text properties are trimmed and their inner whitespace collapsed. Only the configured fields are kept.
- A position is `[longitude, latitude]`; a third number (altitude) is accepted and dropped.
- For a polygon, "touching" counts as crossing: two segments that share any point conflict unless they are consecutive segments of one ring meeting at their common vertex. This is stricter than the OGC rule that lets a hole touch the exterior ring at one point.
- Segment indices in `self_intersection` and `rings_intersect` refer to the ring as it was written (duplicates and all), so they can be looked up in the input.
- Proximity (`--near`) looks at accepted Point features only, using the original, unrounded coordinates and a great-circle distance; a latitude-ordered sweep skips pairs that cannot meet the radius.

## The report

`report.json` is described by [report.schema.json](report.schema.json) and `schemaVersion` is 2. A test validates real reports (the sample, an every-rule file, empty, truncated) against the schema with `ajv`, and checks that thirteen kinds of broken report are refused.

| Field | Content |
| --- | --- |
| `schemaVersion`, `tool` | Format version and the kit's name and version. |
| `options` | The options used, after defaults. `precision` and `nearMeters` are also kept at the top level for version 1 readers. |
| `input`, `accepted`, `rejected`, `output` | Features read, accepted, rejected, and written (more than accepted when MultiPoints were exploded). |
| `bbox`, `geometries`, `categories` | Bounding box of the output (or `null`), output features by geometry type, and by the `--group-by` property. |
| `issues` | One entry per rejected feature: `index` (position in the input), `id` (as written), `code`, `severity`, `message`, `details`. |
| `warnings` | What was fixed or noted on accepted features, at most one entry per code per feature. |
| `nearby` | Pairs of accepted points closer than `--near`: `ids` and `meters`. |
| `counts`, `truncated` | Exact totals by code, and whether a list was cut at `--max-items`. |

An issue and a warning from `examples/messy/report.json`:

~~~json
{"index": 2, "id": "CLINIC-01", "code": "duplicate_id", "severity": "error",
 "message": "The id is already used by the accepted feature at index 0. Give this feature its own id.",
 "details": {"keptIndex": 0, "id": "CLINIC-01"}}
{"index": 11, "id": "ZONE-10", "code": "self_intersection", "severity": "error",
 "message": "Ring 0 crosses itself between segments 0 and 2. Redraw the ring.",
 "details": {"ring": 0, "segments": [0, 2]}}
~~~

`message` is for people and may change; code your consumers against `code` and `details`. For NDJSON input `index` counts non-blank lines from zero.

Changes from the version 1 report (the one `cleanPoints` and the original command line write, which has no `schemaVersion`): `issues[].reason` is now `code` with a larger vocabulary, `issues[].keptIndex` moved to `details.keptIndex`, and `severity`, `message`, `details`, `schemaVersion`, `tool`, `options`, `output`, `geometries`, `warnings`, `counts` and `truncated` were added. `input`, `accepted`, `rejected`, `precision`, `bbox`, `nearMeters`, `nearby` and `categories` keep their names and meaning.

## In the browser

The core runs unchanged in a browser: `index.mjs` and every module it imports use no Node built-ins, `process`, `Buffer` or `require`. Only `cli.mjs`, `stream.mjs` and `benchmark.mjs` import `node:` modules. A page needs nothing but a static server (ES modules do not load from `file:`), and `cleanText` is the entry point for a string:

~~~html
<script type="module">
  import {cleanText} from './index.mjs';
  const result = cleanText(textarea.value, {nearMeters: 15});
  if ('error' in result) show(result.error.line, result.error.column, result.error.message);
  else show(result.cleaned, result.report);
</script>
~~~

`test/browser.test.mjs` checks this two ways. A static pass follows every import from `index.mjs` and fails on a `node:` import or on `process`, `Buffer` or `require`. A browser pass serves this folder from a small static server, opens a blank page in Chromium, imports `/index.mjs` unchanged, and compares the results of cleaning the sample, a file with an example of every rule, a broken JSON text and the original `cleanPoints` with the results in Node: they are equal, there are no console errors, and no request leaves the test server. The test needs Chrome or Chromium through `CHROME_PATH`; without it the test is skipped, and in CI (`REQUIRE_BROWSER=1`) a missing browser fails the run.

## The sample

`sample/facilities.geojson` holds eight fictional records. With the original form, `node cli.mjs sample/facilities.geojson output 5 20`, four pass and four are rejected: a duplicate id, an out-of-range longitude, a non-Point geometry, and a blank name. See [sample/example-report.json](sample/example-report.json) for the report. The full tool with all geometry types also accepts the walkway (a LineString), so `node cli.mjs sample/facilities.geojson output --near 15` accepts five; `--types Point` restores the points-only result. Both are tested.

| Output | Contents |
| --- | --- |
| output/clean.geojson | Cleaned WGS 84 features and their bounding box. |
| output/report.json | The report. |

## Evidence

- **Tests**: 92 tests run with `npm test` (99.74% of lines, gate at 95%, [coverage.txt](docs/evidence/coverage.txt)). They include golden files ([test/fixtures](test/fixtures)), the command line run as a process (flags, exit codes, standard input, NDJSON, the original form), the declarations compiled with `tsc` (`npm run types`), and the examples rebuilt through the command line and compared with the committed files.
- **Exact checks against an independent checker**: 9,000 random polygons must be accepted or rejected exactly where [test/support/oracle.mjs](test/support/oracle.mjs) says, with the same segment indices. The oracle is a brute-force BigInt implementation that shares no code with the library. The orientation, intersection and area predicates are compared with BigInt arithmetic on 20,000 random cases, including slivers whose result a floating-point calculation cannot decide.
- **Random properties** (seeded, repeatable): cleaning twice equals cleaning once; the same input gives the same output; accepted features keep the input order and unique ids; no accepted feature breaks a rule.
- **Compatibility**: `cleanFeatures` restricted to points is compared with the original `cleanPoints` on 200 random collections, and the original command line form is checked against the committed sample report.
- **Scale**: `npm run benchmark` is the small default (20,000 points, 1,000 polygons) and also checks that streaming and in-memory results agree. `npm run benchmark -- --large` generates seeded synthetic data (duplicate ids, bad coordinates, blank properties, broken lines, clockwise and unclosed rings, some self-crossing polygons) and streams it through the pipeline in a fresh process. Measured on Intel(R) Xeon(R) Processor @ 2.30GHz, Node v22.23.4, 4 logical CPUs: 1,050,000 records (1,000,000 points and 50,000 polygons, 200.7 MB of NDJSON) in 12.81 s (81,970 records per second), peak resident memory 274 MB; 1,043,875 accepted, 6,125 rejected, 28,356 nearby pairs. One machine and one run: an illustration of how the streaming path scales, not a promise for other data or hardware.

NDJSON input is cleaned one line at a time and cleaned features are written as they are produced, so memory does not grow with the file; what grows is the id set and the point index for the proximity check. Report lists are capped at `--max-items` while the counts stay exact. A single FeatureCollection file is parsed whole, so use NDJSON for very large inputs.

## Recipe: prepare zones and facilities for flood-exposure-atlas

[flood-exposure-atlas](https://github.com/muhammmmadziam1234-eng/flood-exposure-atlas) imports zones as Polygon or MultiPolygon features with `name` and `level` (`low`, `moderate`, `high`), and facilities as Point features with `id`, `name` and `category` in `properties`. [examples/atlas](examples/atlas) holds a raw file of each and what the kit makes of them:

~~~sh
node cli.mjs examples/atlas/zones-raw.geojson examples/atlas/zones \
  --types Polygon,MultiPolygon --fields "name,level:lower=low|moderate|high" --group-by level
node cli.mjs examples/atlas/facilities-raw.geojson examples/atlas/facilities \
  --types Point,MultiPoint --fields "id,name,category:lower" --near 15
~~~

(`npm run examples` runs these and the messy example.) Of 7 raw zones, 4 are accepted: one level was `severe`, one zone crosses itself and one has no name; `LOW` and `High ` become `low` and `high`, a clockwise unclosed ring is closed and reversed, and the extra `source` and `area_ha` properties are dropped. Of 13 raw facilities, 9 features come out of 8 accepted records: a duplicate id, a latitude of 97, a polygon, a blank name and a missing category are rejected, and a MultiPoint becomes `F08-1` and `F08-2`. `--fields id,...` matters because the atlas reads `properties.id`, not the feature's own `id`.

`npm run check:atlas` runs the atlas's own `validate.mjs` over `examples/atlas/zones/clean.geojson` and `examples/atlas/facilities/clean.geojson`. Result, saved in [docs/evidence/atlas-check.txt](docs/evidence/atlas-check.txt): 4 of 4 zones and 9 of 9 facilities accepted with no problems and with geometry and properties unchanged, while straight from the raw files the atlas accepts 2 of 7 zones and 0 of 13 facilities. A test runs the same check whenever the atlas repository is next to this one (or `ATLAS_DIR` points at it), and always checks the file shapes the atlas imports.

Two differences to know about: the atlas refuses rings with an edge that jumps more than 180 degrees of longitude, which the kit only warns about; and the atlas does not detect self-intersecting rings, which the kit rejects.

## Design decisions

- **No runtime dependencies.** The checks are small enough to own, the package installs nothing, and the core runs where JavaScript runs. `ajv`, `playwright-core` and `typescript` are devDependencies for tests only, pinned to exact versions.
- **RFC 7946 as the base.** Positions are longitude then latitude; exterior rings counter-clockwise and holes clockwise (the right-hand rule, section 3.1.6); rings closed with at least four positions; altitude accepted and dropped; antimeridian crossings (section 3.1.9) flagged rather than cut, because cutting changes the geometry and the consumer may not want it.
- **Warnings for what has one safe fix, errors for the rest.** Rounding, removing consecutive duplicate positions, closing a ring and reversing winding order each have exactly one sensible result, so they are applied and reported. A bow-tie does not: it could be read as two triangles, as one of them, or as a mistake. The kit does not guess; it rejects the feature, says which two segments cross, and leaves the repair to a person or a dedicated tool.
- **Exact arithmetic.** After rounding, positions sit on an integer grid. Orientation and segment tests use plain arithmetic when every product is exactly representable, a floating-point error bound when it is not, and BigInt only when the bound cannot decide. There is no epsilon, so "zero area" and "touching" mean exactly that on the rounded grid.
- **Ids are required.** Duplicate detection and traceability need them, and the original tool required them. Files without ids are rejected feature by feature until ids are added.
- **`cleanPoints` is frozen.** It is the version 1 contract: same results and the same version 1 report. New behaviour goes through `cleanFeatures`, which orders ties by code unit instead of the machine's locale so output does not depend on where it ran.
- **A stable report.** Codes and details are the contract; messages are for people. The schema is closed (no unknown fields), and a test keeps its code list, the table above and `lib/codes.mjs` identical.

## Limits and next steps

- WGS 84 longitude and latitude only. There is no reprojection, and an axis swap that stays in range (a latitude typed as a longitude below 90) cannot be detected.
- Geometry is checked per feature. Overlap between features, or between the members of a MultiPolygon, is not checked; no topology repair is done by design.
- Longitude is treated as a plain x axis. A polygon that crosses the antimeridian is checked as drawn and flagged, not split.
- Every feature needs an id in `id` or `properties.id`. Only text properties are supported, and only the configured fields are kept.
- The proximity check covers points only. Its index holds one entry per accepted point in memory, and a very dense cluster makes the sweep slower (a cap on the list does not cap the work).
- A FeatureCollection file is read whole; only NDJSON is streamed.
- The GitHub Actions workflow (Node 22 and 24, coverage gate, declaration check, `npm pack --dry-run`, benchmark smoke run) was written here but could not be run here, so the badge above is its real state; `npm test` on Node 22 and on Node 24 passed on this machine.
- The browser check runs in Chromium only, and needs `CHROME_PATH` (skipped locally without it). BigInt, which the exact fallback uses, must exist in the browser.
- The benchmark is one run on one machine.
- Next steps worth doing: splitting at the antimeridian as an option, opt-in repairs, overlap checks with a spatial index, and a streaming reader for very large single-file collections.

## Files

| Path | Role |
| --- | --- |
| `index.mjs`, `index.d.ts` | Public API and its types |
| `lib/` | Rules, exact predicates, report building, proximity index, JSON error locator |
| `cli.mjs`, `stream.mjs` | Command line and NDJSON streaming (the only files that use Node built-ins, with the benchmark) |
| `quality.mjs` | The original points-only cleaner, unchanged |
| `report.schema.json` | JSON Schema of the report |
| `examples/`, `sample/` | Messy example, atlas recipe inputs and outputs; the original sample |
| `test/`, `scripts/`, `benchmark.mjs` | Tests and fixtures, the coverage gate and example builders, the benchmark |
| `docs/evidence/` | Measured output: coverage, benchmark, atlas check |

© 2026 muhammmmadziam1234-eng. All rights reserved.
