import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../src/campus-import.js';
import '../src/thermal.js';
import '../src/engine.js';

const I = globalThis.ShadeCampusImport;
const example = JSON.parse(await readFile(new URL('../examples/campus-network.json', import.meta.url), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const checkError = (fn, code) => assert.throws(fn, error => error instanceof I.CampusImportError && error.code === code && typeof error.message === 'string');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=';

test('network JSON preserves crossings and shared sections without mutating or retaining caller objects', () => {
  const input = copy(example), before = copy(input), result = I.validate(input);
  assert.equal(result.paths.length, 4);
  assert.equal(result.paths[3].demand, 0.6);
  assert.deepEqual(result.route, result.paths[0].points);
  assert.notEqual(result.route, result.paths[0].points);
  assert.deepEqual(input, before);
  result.paths[0].points[0].x = 99;
  assert.equal(input.paths[0].points[0].x, 20);
  assert.equal(I.parseJSON('\uFEFF' + JSON.stringify(example)).paths.length, 4);
});

test('legacy route becomes one path, while explicit empty paths never reuse a sample route', () => {
  const input = copy(example); delete input.paths;
  input.route = [{ x: 1, y: 2 }, { x: 10, y: 2 }];
  assert.equal(I.validate(input).paths.length, 1);
  input.paths = [];
  assert.deepEqual(I.validate(input).route, []);
  assert.deepEqual(I.validate(input).paths, []);
});

test('JSON parsing rejects malformed text, unsupported schemas and excessive input size', () => {
  checkError(() => I.parseJSON('{bad'), 'invalid_json');
  checkError(() => I.parseJSON('null'), 'invalid_type');
  checkError(() => I.validate({ ...example, schemaVersion: 2 }), 'schema_version');
  checkError(() => I.parseJSON(' '.repeat(I.limits.jsonBytes + 1)), 'json_too_large');
});

test('numeric geometry rejects nonfinite numbers, strings, zero dimensions and points outside bounds', () => {
  for (const value of [NaN, Infinity, '220']) checkError(() => I.validate({ ...example, bounds: { width: value, height: 120 } }), 'invalid_number');
  checkError(() => I.validate({ ...example, bounds: { width: 0, height: 120 } }), 'positive_required');
  checkError(() => I.validate({ ...example, bounds: { width: 10001, height: 120 } }), 'number_range');
  const input = copy(example); input.paths[0].points[0].x = -1;
  checkError(() => I.validate(input), 'point_outside');
});

test('path minimum length, demand, count, points and overall network length are bounded', () => {
  const input = copy(example); input.paths[0].points = [{ x: 1, y: 1 }];
  checkError(() => I.validate(input), 'path_too_short');
  input.paths[0].points.push({ x: 1, y: 1 });
  checkError(() => I.validate(input), 'path_zero_length');
  input.paths = [{ id: 'p', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }], demand: 0 }];
  checkError(() => I.validate(input), 'positive_required');
  input.paths = Array.from({ length: 129 }, (_, i) => ({ id: `p${i}`, points: [{ x: 1, y: 1 }, { x: 2, y: 1 }] }));
  checkError(() => I.validate(input), 'too_complex');
  input.paths = [{ id: 'p', points: Array.from({ length: 2049 }, (_, i) => ({ x: i % 2, y: 1 })) }];
  checkError(() => I.validate(input), 'too_complex');
  input.bounds = { width: 10000, height: 120 };
  input.paths = [{ id: 'p', points: [{ x: 0, y: 1 }, { x: 10000, y: 1 }, { x: 9999, y: 1 }] }];
  checkError(() => I.validate(input), 'network_too_long');
});

test('IDs are unique across all geometry groups', () => {
  const input = copy(example); input.trees[0].id = input.buildings[0].id;
  checkError(() => I.validate(input), 'duplicate_id');
  input.trees[0].id = '<img onerror=alert(1)>';
  checkError(() => I.validate(input), 'invalid_id');
});

test('buildings accept clockwise closed convex rings but reject concavity and self-intersections', () => {
  const input = copy(example);
  input.buildings[0].polygon.reverse(); input.buildings[0].polygon.push({ ...input.buildings[0].polygon[0] });
  assert.equal(I.validate(input).buildings[0].polygon.length, 4);
  input.buildings[0].polygon = [{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 4, y: 4 }, { x: 10, y: 10 }, { x: 1, y: 10 }];
  checkError(() => I.validate(input), 'polygon_not_convex');
  input.buildings[0].polygon = [{ x: 1, y: 1 }, { x: 10, y: 10 }, { x: 1, y: 10 }, { x: 10, y: 1 }];
  checkError(() => I.validate(input), 'polygon_self_intersection');
  input.buildings[0].polygon = [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 }];
  checkError(() => I.validate(input), 'polygon_degenerate');
});

test('tree dimensions are numeric, positive and physically above ground', () => {
  const input = copy(example); input.trees[0].radius = 'javascript:alert(1)';
  checkError(() => I.validate(input), 'invalid_number');
  input.trees[0].radius = 0;
  checkError(() => I.validate(input), 'positive_required');
  input.trees[0].radius = 9; input.trees[0].height = 8;
  checkError(() => I.validate(input), 'tree_shape');
});

test('script fields, remote URLs, prototype pollution and accessors are rejected without execution', () => {
  for (const key of ['script', 'onclick', 'src', 'imageURL', '__proto__', 'constructor']) {
    const text = JSON.stringify(example).replace('"schemaVersion":1', `"schemaVersion":1,"${key}":"https://evil.invalid/x"`);
    checkError(() => I.parseJSON(text), 'unsafe_field');
  }
  const input = copy(example); let accessed = false;
  Object.defineProperty(input, 'unexpected', { enumerable: true, get() { accessed = true; return 1; } });
  checkError(() => I.validate(input), 'unsafe_field'); assert.equal(accessed, false);
  assert.equal({}.polluted, undefined);
});

test('deep or cyclic structures fail safely and leave active data unchanged', () => {
  const input = copy(example); input.extra = input;
  checkError(() => I.validate(input), 'invalid_type');
  const current = I.validate(example), snapshot = JSON.stringify(current);
  const invalid = copy(example); invalid.paths[0].points[0].y = 999;
  checkError(() => I.validate(invalid), 'point_outside');
  assert.equal(JSON.stringify(current), snapshot);
  const deep = copy(example); let cursor = deep;
  for (let i = 0; i < 25; i++) { cursor.child = {}; cursor = cursor.child; }
  checkError(() => I.validate(deep), 'too_complex');
});

test('local image creates an empty measured plane, no sample route or assumed campus identity', () => {
  const result = I.fromImage({ dataUrl: png, pixelWidth: 1, pixelHeight: 1, widthMeters: 200, name: '地图.png' });
  assert.deepEqual(result.bounds, { width: 200, height: 200 });
  assert.deepEqual(result.paths, []); assert.deepEqual(result.route, []);
  assert.deepEqual(result.trees, []); assert.deepEqual(result.buildings, []);
  assert.equal(result.image.widthMeters, 200); assert.equal(result.image.northRotation, 0);
  assert.equal(result.metadata.title, '地图.png'); assert.equal(result.metadata.campusName, undefined);
  assert.equal(result.location.source, 'unverified-default');
});

test('image import rejects remote URLs, SVG, wrong signatures, wrong scale, rotation and oversized pixels', () => {
  const make = (override = {}) => I.fromImage({ dataUrl: png, pixelWidth: 1, pixelHeight: 1, widthMeters: 220, ...override });
  checkError(() => make({ dataUrl: 'https://example.invalid/map.png' }), 'image_format');
  checkError(() => make({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), 'image_format');
  checkError(() => make({ dataUrl: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' }), 'image_format');
  checkError(() => make({ northRotation: 90 }), 'north_rotation');
  checkError(() => make({ pixelWidth: 5000, pixelHeight: 5000 }), 'image_dimensions');
  const scaled = make(); scaled.bounds.height = 100;
  checkError(() => I.validate(scaled), 'image_scale');
  checkError(() => make({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(Math.ceil(I.limits.imageBytes / 3) * 4 + 68) }), 'image_too_large');
});

test('campus naming and geocoding provenance survive normalized imports', () => {
  const input = copy(example);
  input.metadata = { name: '本地结构', campusName: '示例学校', title: '校区总图' };
  input.location = { latitude: 51.5, longitude: -0.1, timezone: 1, timezoneName: 'Europe/London', source: 'OpenStreetMap Nominatim', query: '示例学校', displayName: '示例学校，伦敦' };
  const result = I.validate(input);
  assert.equal(result.metadata.campusName, '示例学校');
  assert.deepEqual(result.location, input.location);
  input.location.timezoneName = 'Fake/Zone';
  checkError(() => I.validate(input), 'invalid_timezone');
});

test('exported scenarios preserve baseline identity/settings and discard untrusted derived metrics', () => {
  const E = globalThis.ShadeEngine;
  const settings = { ...E.defaults, minutes: 900, airTemperature: 32, relativeHumidity: 55, windSpeed: 1.2 };
  const plan = E.optimize(E.campus, 1350, settings);
  const exported = E.exportCampus(E.campus, plan.trees, settings, 1350);
  const inputCopy = JSON.stringify(exported);
  exported.scenario.metrics.meanUTCI = -999;
  const normalized = I.parseJSON(JSON.stringify(exported));
  assert.equal(normalized.scenario.metrics, undefined);
  assert.deepEqual(normalized.scenario.addedTreeIds, exported.scenario.addedTreeIds);
  assert.deepEqual(normalized.scenario.baselineTreeIds, exported.scenario.baselineTreeIds);
  const restored = E.restoreScenario(normalized);
  assert.equal(restored.budget, 1350); assert.equal(restored.settings.minutes, 900);
  assert.equal(restored.trees.length, plan.trees.length);
  assert.equal(E.campus.trees.length, JSON.parse(inputCopy).scenario.baselineTreeIds.length);
  const malformed = copy(exported); malformed.scenario.addedTreeIds.push('unknown-tree');
  checkError(() => I.validate(malformed), 'scenario_id');
  const differentPrice = copy(exported);
  differentPrice.trees.find(tree => differentPrice.scenario.addedTreeIds.includes(tree.id)).cost = 999;
  checkError(() => I.validate(differentPrice), 'scenario_tree_cost');
  const existingPrice = copy(exported);
  existingPrice.trees.find(tree => existingPrice.scenario.baselineTreeIds.includes(tree.id)).cost = 999;
  assert.equal(I.validate(existingPrice).trees.find(tree => tree.cost === 999).existing, true);
});
