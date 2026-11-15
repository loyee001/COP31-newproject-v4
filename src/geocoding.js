/* ShadePath location normalization and date-aware IANA timezone conversion.
 * Nominatim: https://nominatim.org/release-docs/latest/api/Search/
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 * This module has no network or DOM access. The local server performs explicit
 * user-triggered queries, caches them, and limits Nominatim to one request/sec.
 */
(function (root) {
  'use strict';
  class GeocodingError extends Error {
    constructor(code, message) { super(message); this.name = 'GeocodingError'; this.code = code; }
  }
  const error = (code, message) => { throw new GeocodingError(code, message); };
  const text = value => typeof value === 'string' ? value.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 500) : '';
  const formatters = new Map();
  function formatter(zone) {
    if (typeof zone !== 'string' || zone.length > 80 || !/^[A-Za-z0-9_+\/-]+$/.test(zone)) error('invalid_timezone', '无法确认该地点的时区');
    if (!formatters.has(zone)) {
      let value;
      try { value = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
      catch { error('invalid_timezone', '无法确认该地点的时区'); }
      if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
      formatters.set(zone, value);
    }
    return formatters.get(zone);
  }
  function isValidTimeZone(zone) { try { formatter(zone); return true; } catch { return false; } }
  function timezoneOffset(zone, date) {
    const format = formatter(zone);
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) error('invalid_date', '日期必须使用 YYYY-MM-DD 格式');
    const nominal = Date.parse(`${date}T12:00:00Z`);
    if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 10) !== date) error('invalid_date', '日期不存在');
    function partsAt(instant) { return Object.fromEntries(format.formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)])); }
    function offsetAt(instant) {
      const p = partsAt(instant), wall = new Date(0);
      wall.setUTCFullYear(p.year, p.month - 1, p.day); wall.setUTCHours(p.hour === 24 ? 0 : p.hour, p.minute, p.second, 0);
      return (wall.getTime() - instant) / 3600000;
    }
    // Solve for local noon; UTC noon may be on the next date in UTC+14.
    let instant = nominal;
    for (let i = 0; i < 3; i++) instant = nominal - offsetAt(instant) * 3600000;
    const p = partsAt(instant), localDate = `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    if (localDate !== date || p.hour !== 12) error('invalid_local_date', '该日期在所选时区中不存在或无法确定');
    return offsetAt(instant);
  }
  function coordinate(value, min, max) {
    if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const result = Number(value);
    return Number.isFinite(result) && result >= min && result <= max ? result : null;
  }
  function normalizeResults(data) {
    if (!Array.isArray(data)) error('invalid_results', '地点查询服务返回的数据格式无效');
    const result = [], seen = new Set();
    for (const raw of data.slice(0, 50)) {
      if (!raw || typeof raw !== 'object') continue;
      const latitude = coordinate(raw.lat ?? raw.latitude, -90, 90), longitude = coordinate(raw.lon ?? raw.longitude, -180, 180);
      const displayName = text(raw.display_name ?? raw.displayName), name = text(raw.name) || displayName.split(',')[0].trim();
      if (latitude === null || longitude === null || !displayName || !name) continue;
      const country = raw.address?.country_code ?? raw.countryCode;
      const countryCode = typeof country === 'string' && /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : '';
      let timezoneName = countryCode === 'cn' ? 'Asia/Shanghai' : raw.extratags?.timezone ?? raw.timezoneName ?? null;
      if (!isValidTimeZone(timezoneName)) timezoneName = null;
      const key = `${latitude.toFixed(7)}|${longitude.toFixed(7)}|${displayName}`;
      if (seen.has(key)) continue;
      seen.add(key); result.push({ latitude, longitude, displayName, name, timezoneName, countryCode, source: 'OpenStreetMap Nominatim' });
      if (result.length === 5) break;
    }
    return result;
  }
  const attribution = Object.freeze({ text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', usagePolicy: 'https://operations.osmfoundation.org/policies/nominatim/' });
  root.ShadeGeocoding = Object.freeze({ normalizeResults, timezoneOffset, isValidTimeZone, GeocodingError, attribution });
})(globalThis);
