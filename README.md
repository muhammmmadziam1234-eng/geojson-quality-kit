# GeoJSON Quality Kit

A small command-line data cleanup pipeline for a facility inventory. It standardizes identifiers and labels, checks WGS 84 longitude/latitude bounds, keeps the first valid occurrence of each ID, and reports exactly which input records were rejected. It also flags nearby accepted sites for manual review without merging records that may represent distinct facilities.

## Run

Requires Node.js 22 or later. No packages are needed.

~~~sh
npm test
npm run demo
node cli.mjs sample/facilities.geojson output 5 20
~~~

The sample inventory contains eight fictional records. Four pass; four are rejected because of a duplicate ID, out-of-range coordinates, the wrong geometry type, or a missing name.

| Output | Contents |
| --- | --- |
| output/clean.geojson | Cleaned WGS 84 Point features and their bounding box. |
| output/report.json | Counts by category, coordinate precision, indexed rejection reasons, and nearby site pairs. |

Input must be a FeatureCollection with Point coordinates [longitude, latitude]. Each feature needs a string ID (feature ID or properties.id), a name, and a category. The tool retains only these fields. Coordinates are rounded to six decimal places by default. The optional final argument sets the proximity radius in metres (default 15; zero disables it). Distances use the original coordinates and a great-circle calculation. A latitude-ordered sweep skips pairs that cannot meet the radius. This tool checks coordinate ranges; it does not reproject coordinates or verify real-world locations.

See [sample output](sample/example-report.json) for a report generated from the included input.
