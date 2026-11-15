import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import './src/geocoding.js';

const G = globalThis.ShadeGeocoding;
const page = new URL('./ShadePath-preview.html', import.meta.url);
const host = '127.0.0.1', port = 4198;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TIMEZONE_LOOKUP = 'https://api.open-meteo.com/v1/forecast';
const USER_AGENT = 'ShadePath/1.0 (local campus shade planning)';
const clone = value => JSON.parse(JSON.stringify(value));
const geoError = (code, message) => new G.GeocodingError(code, message);

// Operator-controlled stop switch; browser inputs can never select an upstream.
// https://operations.osmfoundation.org/policies/nominatim/
// Deliberate submissions only: no autocomplete or periodic polling.
export function createLocationService({ fetchImpl = globalThis.fetch, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 12000, disabled = process.env.SHADEPATH_GEOCODING_DISABLED === '1' } = {}) {
  const cache = new Map(), inflight = new Map(), timezoneCache = new Map();
  const ttl = 24 * 60 * 60 * 1000, maxCache = 100;
  let queue = Promise.resolve(), previousStart = -Infinity, pending = 0;
  function remember(map, key, value, limit = maxCache) {
    if (map.size >= limit && !map.has(key)) map.delete(map.keys().next().value);
    map.set(key, value);
  }
  async function getJSON(url, signal) {
    const response = await fetchImpl(url.href, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal, redirect: 'error' });
    if (!response.ok) throw geoError('upstream_unavailable', '地点查询服务暂不可用，请稍后重试');
    const declared = Number(response.headers?.get?.('content-length'));
    if (declared > 262144) throw geoError('invalid_results', '地点查询服务返回的数据过大');
    const body = await response.text();
    if (Buffer.byteLength(body) > 262144) throw geoError('invalid_results', '地点查询服务返回的数据过大');
    try { return JSON.parse(body); } catch { throw geoError('invalid_results', '地点查询服务返回的数据格式无效'); }
  }
  async function findTimezone(candidate, signal) {
    if (candidate.timezoneName) return candidate;
    const key = `${candidate.latitude.toFixed(7)},${candidate.longitude.toFixed(7)}`;
    if (timezoneCache.has(key)) return { ...candidate, timezoneName: timezoneCache.get(key) };
    const url = new URL(TIMEZONE_LOOKUP);
    url.search = new URLSearchParams({ latitude: String(candidate.latitude), longitude: String(candidate.longitude), timezone: 'auto', forecast_days: '1' }).toString();
    try {
      const data = await getJSON(url, signal);
      if (G.isValidTimeZone(data.timezone)) {
        remember(timezoneCache, key, data.timezone, 256);
        return { ...candidate, timezoneName: data.timezone, timezoneSource: 'Open-Meteo' };
      }
    } catch { /* Preserve valid coordinates; never invent a timezone. */ }
    return { ...candidate, timezoneName: null };
  }
  async function execute(query) {
    const delay = Math.max(0, 1000 - (now() - previousStart));
    if (delay) await wait(delay);
    previousStart = now();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(NOMINATIM);
      url.search = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', extratags: '1', limit: '5', 'accept-language': 'zh-CN,en' }).toString();
      const raw = await getJSON(url, controller.signal);
      const candidates = await Promise.all(G.normalizeResults(raw).map(candidate => findTimezone(candidate, controller.signal)));
      return { candidates, attribution: { ...G.attribution }, timezoneAttribution: { text: 'Timezone lookup by Open-Meteo', url: 'https://open-meteo.com/' } };
    } catch (error) {
      if (controller.signal.aborted) throw geoError('request_timeout', '地点查询超时，请稍后重试');
      if (error instanceof G.GeocodingError) throw error;
      throw geoError('network_error', '无法连接地点查询服务，请检查网络后重试');
    } finally { clearTimeout(timeout); }
  }
  async function lookup(value) {
    if (disabled) throw geoError('geocoding_disabled', '自动定位暂时关闭；校园数据与算法仍可离线使用');
    if (typeof value !== 'string') throw geoError('invalid_query', '请输入校园名称及所在地区');
    const query = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (query.length < 2 || query.length > 120 || /[<>\u0000-\u001f\u007f]/.test(query)) throw geoError('invalid_query', '校园名称须为 2 至 120 个字符，不能包含标签或控制字符');
    const key = query.toLocaleLowerCase('en-US'), hit = cache.get(key);
    if (hit && now() - hit.savedAt < ttl) return { ...clone(hit.value), cached: true };
    if (inflight.has(key)) return { ...clone(await inflight.get(key)), cached: true };
    if (pending >= 8) throw geoError('busy', '地点查询正在排队，请稍后重试');
    pending++;
    const task = queue.then(() => execute(query));
    queue = task.catch(() => {}); inflight.set(key, task);
    try {
      const result = await task; remember(cache, key, { savedAt: now(), value: result });
      return { ...clone(result), cached: false };
    } finally { pending--; inflight.delete(key); }
  }
  return Object.freeze({ lookup });
}

export function createPreviewServer({ locationService = createLocationService() } = {}) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-store');
    let url;
    try { url = new URL(request.url, `http://${host}:${port}`); }
    catch { response.writeHead(400); response.end('Invalid URL'); return; }
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    if (url.pathname === '/api/campus-location') {
      if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); json(405, { error: { code: 'method_not_allowed', message: '校园定位只支持 GET 请求' } }); return; }
      const origin = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin))) { json(403, { error: { code: 'origin_denied', message: '仅允许本地网页请求校园定位' } }); return; }
      if ([...url.searchParams.keys()].some(key => key !== 'q') || url.searchParams.getAll('q').length !== 1) { json(400, { error: { code: 'invalid_query', message: '请输入一个校园名称查询' } }); return; }
      try { json(200, await locationService.lookup(url.searchParams.get('q'))); }
      catch (error) {
        const status = error.code === 'invalid_query' ? 400 : error.code === 'busy' ? 429 : error.code === 'request_timeout' ? 504 : 503;
        json(status, { error: { code: error.code || 'network_error', message: error.message || '地点查询失败' } });
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed'); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (!['/', '/index.html', '/ShadePath-preview.html'].includes(url.pathname)) { response.writeHead(404); response.end('Not found'); return; }
    try {
      const html = await readFile(page);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length }); response.end(request.method === 'HEAD' ? undefined : html);
    } catch { response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Preview not built. Run npm run build first.'); }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = createPreviewServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Reuse an existing ShadePath preview or open ShadePath-preview.html directly.` : `Unable to start local preview: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`ShadePath local preview: http://${host}:${port}/`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
