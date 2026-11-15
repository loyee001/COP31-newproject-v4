import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/geocoding.js';
import { createLocationService, createPreviewServer } from '../server.mjs';

const G = globalThis.ShadeGeocoding;
const raw = (name = '示例大学', extra = {}) => ({ lat: '31.2', lon: '121.4', name, display_name: `${name}，上海，中国`, address: { country_code: 'cn' }, ...extra });
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const rejectCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('location results keep ambiguity, normalize coordinates, deduplicate exact matches and limit to five', () => {
  const result = G.normalizeResults([raw(), raw(), raw('另一校区'), raw('坏坐标', { lat: 'NaN' }), raw('空坐标', { lon: '' })]);
  assert.equal(result.length, 2);
  assert.equal(result[0].latitude, 31.2); assert.equal(result[0].longitude, 121.4);
  assert.equal(result[0].timezoneName, 'Asia/Shanghai'); assert.equal(result[0].source, 'OpenStreetMap Nominatim');
  assert.equal(G.normalizeResults(Array.from({ length: 10 }, (_, i) => raw(`大学${i}`))).length, 5);
  assert.throws(() => G.normalizeResults({}), error => error.code === 'invalid_results');
});

test('unknown timezones stay null, invalid metadata is discarded and names remain plain text', () => {
  const result = G.normalizeResults([raw('<学院>', { address: { country_code: 'gb' }, extratags: { timezone: 'Fake/Zone' }, script: 'alert(1)' })])[0];
  assert.equal(result.name, '学院'); assert.equal(result.timezoneName, null); assert.equal(result.script, undefined);
  assert.equal(G.normalizeResults([raw('伦敦学校', { address: { country_code: 'gb' }, extratags: { timezone: 'Europe/London' } })])[0].timezoneName, 'Europe/London');
});

test('date-aware timezone offsets handle DST, fractional offsets and UTC+14', () => {
  for (const [zone, date, expected] of [
    ['Asia/Shanghai', '2026-06-21', 8], ['America/New_York', '2026-01-15', -5],
    ['America/New_York', '2026-07-15', -4], ['America/New_York', '2026-03-08', -4],
    ['Europe/London', '2026-03-29', 1], ['Europe/London', '2026-11-15', 0],
    ['Asia/Kathmandu', '2026-06-21', 5.75], ['Australia/Adelaide', '2026-01-15', 10.5],
    ['Australia/Adelaide', '2026-07-15', 9.5], ['Pacific/Kiritimati', '2026-11-15', 14],
    ['UTC', '2026-11-15', 0]
  ]) assert.equal(G.timezoneOffset(zone, date), expected, `${zone} ${date}`);
});

test('invalid and skipped dates or IANA timezone names fail explicitly', () => {
  assert.throws(() => G.timezoneOffset('Fake/Zone', '2026-01-01'), error => error.code === 'invalid_timezone');
  assert.throws(() => G.timezoneOffset('UTC', '2026-02-30'), error => error.code === 'invalid_date');
  assert.throws(() => G.timezoneOffset('Pacific/Apia', '2011-12-30'), error => error.code === 'invalid_local_date');
});

test('server caches and coalesces queries, identifies application and globally spaces searches by one second', async () => {
  let clock = 0;
  const calls = [];
  const service = createLocationService({ now: () => clock, wait: async ms => { clock += ms; }, fetchImpl: async (url, options) => { calls.push({ url: new URL(url), options, at: clock }); return response([raw()]); } });
  const [first, same] = await Promise.all([service.lookup('示例大学 上海'), service.lookup(' 示例大学   上海 ')]);
  assert.equal(calls.length, 1); assert.equal(first.cached, false); assert.equal(same.cached, true);
  first.candidates[0].latitude = -99;
  const cached = await service.lookup('示例大学 上海'); assert.equal(cached.candidates[0].latitude, 31.2);
  await service.lookup('另一大学 上海');
  assert.equal(calls.length, 2); assert.ok(calls[1].at - calls[0].at >= 1000);
  assert.equal(calls[0].url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(calls[0].url.searchParams.get('format'), 'jsonv2');
  assert.equal(calls[0].url.searchParams.get('limit'), '5');
  assert.match(calls[0].options.headers['User-Agent'], /^ShadePath\/1\.0/);
  assert.equal(calls[0].options.redirect, 'error');
  assert.match(cached.attribution.url, /openstreetmap.org\/copyright$/);
  clock += 24 * 60 * 60 * 1000 + 1;
  await service.lookup('示例大学 上海'); assert.equal(calls.length, 3);
});

test('outside China the server obtains only timezone metadata from a fixed Open-Meteo URL', async () => {
  const calls = [];
  const service = createLocationService({ fetchImpl: async url => {
    const u = new URL(url); calls.push(u);
    return response(u.hostname === 'nominatim.openstreetmap.org' ? [raw('London School', { lat: '51.5', lon: '-0.1', address: { country_code: 'gb' } })] : { timezone: 'Europe/London' });
  } });
  const result = await service.lookup('London School');
  assert.equal(result.candidates[0].timezoneName, 'Europe/London');
  assert.equal(calls.length, 2); assert.equal(calls[1].origin, 'https://api.open-meteo.com');
  assert.equal(calls[1].searchParams.get('timezone'), 'auto');
  assert.equal(calls[1].searchParams.has('hourly'), false); assert.equal(calls[1].searchParams.has('current'), false);
});

test('failed timezone lookup preserves candidates with null zone instead of guessing', async () => {
  const service = createLocationService({ fetchImpl: async url => {
    if (new URL(url).hostname === 'nominatim.openstreetmap.org') return response([raw('Unknown school', { address: { country_code: 'us' } })]);
    throw new Error('offline');
  } });
  const result = await service.lookup('Unknown school');
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].timezoneName, null);
});

test('query validation, upstream failures, timeouts and operator disable fail without fabricated matches', async () => {
  let calls = 0;
  const service = createLocationService({ fetchImpl: async () => { calls++; throw new Error('offline'); } });
  await rejectCode(service.lookup('x'), 'invalid_query'); await rejectCode(service.lookup('<script>'), 'invalid_query');
  await rejectCode(service.lookup('a'.repeat(121)), 'invalid_query'); assert.equal(calls, 0);
  await rejectCode(service.lookup('Campus school'), 'network_error'); assert.equal(calls, 1);
  await rejectCode(createLocationService({ disabled: true }).lookup('Campus school'), 'geocoding_disabled');
  const timeout = createLocationService({ timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await rejectCode(timeout.lookup('Campus school'), 'request_timeout');
});

test('HTTP routing accepts only the precise GET API and preserves static-file restrictions', async () => {
  let calls = 0;
  const server = createPreviewServer({ locationService: { lookup: async query => { calls++; return { candidates: [{ name: query }], attribution: G.attribution, cached: false }; } } });
  function dispatch(method, url, headers = {}) {
    return new Promise(resolve => {
      const output = { status: 200, headers: {} };
      const res = { setHeader(key, value) { output.headers[key.toLowerCase()] = value; }, writeHead(status, values = {}) { output.status = status; for (const [k, v] of Object.entries(values)) this.setHeader(k, v); }, end(body = '') { resolve({ ...output, body: String(body) }); } };
      server.emit('request', { method, url, headers }, res);
    });
  }
  const success = await dispatch('GET', '/api/campus-location?q=Campus');
  assert.equal(success.status, 200); assert.equal(JSON.parse(success.body).candidates[0].name, 'Campus');
  assert.equal((await dispatch('POST', '/api/campus-location?q=Campus')).status, 405);
  assert.equal((await dispatch('GET', '/api/campus-location?q=Campus&url=https://evil.invalid')).status, 400);
  assert.equal((await dispatch('GET', '/api/campus-location?q=Campus', { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await dispatch('GET', '/api/campus-location?q=Campus', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await dispatch('GET', '/src/engine.js')).status, 404);
  assert.equal((await dispatch('GET', '/api/campus-location/extra?q=Campus')).status, 404);
  assert.equal(calls, 1);
});
