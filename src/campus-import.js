/* ShadePath local campus import. Pure validation/normalization; no DOM, fetch or
 * engine dependency. Callers replace active state only after a successful return.
 * Images are local raster data only. Coordinates are metres, x east / y north.
 */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({
    jsonBytes: 16 * 1024 * 1024, imageBytes: 8 * 1024 * 1024,
    boundsMeters: 10000, paths: 128, pathPoints: 2048, pathLengthMeters: 10000,
    pathWidthMeters: 100, buildings: 128, polygonPoints: 64,
    buildingPoints: 2048, trees: 1024, imageSidePixels: 16384,
    imagePixels: 16000000, objectNodes: 100000, objectDepth: 20
  });
  const DEFAULT_LOCATION = Object.freeze({ latitude: 31.23, longitude: 121.47, timezone: 8 });
  const DEFAULT_TREE = Object.freeze({ height: 8, radius: 4.6, cost: 95 });
  class CampusImportError extends Error {
    constructor(code, message, path = '') {
      super(message + (path ? `（${path}）` : ''));
      this.name = 'CampusImportError'; this.code = code; this.path = path;
    }
  }
  const fail = (code, message, path) => { throw new CampusImportError(code, message, path); };
  function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_type', '需要一个对象', path);
    return value;
  }
  function number(value, path, min = -Infinity, max = Infinity) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('invalid_number', '数值必须是有限数字', path);
    if (value < min || value > max) fail('number_range', `数值须在 ${min} 到 ${max} 之间`, path);
    return value;
  }
  function positive(value, path, max) {
    number(value, path, 0, max);
    if (value === 0) fail('positive_required', '数值必须大于零', path);
    return value;
  }
  function array(value, path, max) {
    if (!Array.isArray(value)) fail('invalid_type', '需要一个数组', path);
    if (value.length > max) fail('too_complex', `数组最多允许 ${max} 项`, path);
    return value;
  }
  function plainText(value, path, max = 120) {
    if (typeof value !== 'string' || value.length > max || /[<>\u0000-\u001f\u007f]/.test(value)) {
      fail('invalid_text', `文本最多 ${max} 字符，不能包含标签或控制字符`, path);
    }
    return value.trim();
  }
  // Reject executable fields even if a later schema step would discard them.
  // Descriptors prevent validate(object) from invoking a hostile accessor.
  function inspect(value) {
    let nodes = 0;
    const active = new WeakSet();
    function walk(item, path, depth) {
      if (++nodes > LIMITS.objectNodes || depth > LIMITS.objectDepth) fail('too_complex', '数据层级或内容过于复杂', path);
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
      if (typeof item === 'number') { number(item, path); return; }
      if (typeof item !== 'object') fail('invalid_type', '只允许 JSON 数据类型', path);
      if (active.has(item)) fail('invalid_type', '数据不能循环引用', path);
      const proto = Object.getPrototypeOf(item);
      if (proto !== (Array.isArray(item) ? Array.prototype : Object.prototype) && proto !== null) fail('invalid_type', '只允许普通数据对象', path);
      active.add(item);
      const descriptors = Object.getOwnPropertyDescriptors(item);
      for (const key of Object.keys(descriptors)) {
        if (Array.isArray(item) && key === 'length') continue;
        const next = path ? `${path}.${key}` : key;
        const forbidden = /^(?:__proto__|constructor|prototype|script|scripts|javascript|html|innerhtml|outerhtml|srcdoc|src|href)$/i.test(key)
          || /^on[a-z]/i.test(key) || (/url$/i.test(key) && key !== 'dataUrl');
        if (forbidden) fail('unsafe_field', '不允许脚本、远程资源或原型字段', next);
        const descriptor = descriptors[key];
        if (!('value' in descriptor)) fail('unsafe_field', '不允许可执行属性', next);
        if (key === 'dataUrl' && (typeof descriptor.value !== 'string' || !descriptor.value.startsWith('data:image/'))) fail('image_format', '只允许本地内嵌图片，不允许远程图片地址', next);
        walk(descriptor.value, next, depth + 1);
      }
      active.delete(item);
    }
    walk(value, '', 0);
  }
  function identifier(value, path, used, fallback) {
    const id = value === undefined ? fallback : value;
    if (typeof id !== 'string' || id.length < 1 || id.length > 80 || !/^[\p{L}\p{N}_.:-]+$/u.test(id)) {
      fail('invalid_id', '标识只能使用文字、数字、点、下划线、冒号或连字符', path);
    }
    if (used.has(id)) fail('duplicate_id', `标识重复：${id}`, path);
    used.add(id); return id;
  }
  function point(value, path, bounds) {
    object(value, path);
    const x = number(value.x, `${path}.x`), y = number(value.y, `${path}.y`);
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) fail('point_outside', '坐标超出校园边界', path);
    return { x, y };
  }
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  function segmentTouch(a, b, c, d) {
    const eps = 1e-9;
    const on = (p, q, r) => Math.abs(cross(p, q, r)) <= eps && r.x >= Math.min(p.x, q.x) - eps && r.x <= Math.max(p.x, q.x) + eps && r.y >= Math.min(p.y, q.y) - eps && r.y <= Math.max(p.y, q.y) + eps;
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    return (abC * abD < 0 && cdA * cdB < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
  }
  function polygon(value, path, bounds) {
    const points = array(value, path, LIMITS.polygonPoints + 1).map((p, i) => point(p, `${path}[${i}]`, bounds));
    if (points.length > 1 && distance(points[0], points.at(-1)) === 0) points.pop();
    if (points.length < 3 || points.length > LIMITS.polygonPoints) fail('polygon_degenerate', '建筑轮廓需要 3 至 64 个顶点', path);
    for (let i = 0; i < points.length; i++) {
      if (points.some((p, j) => j > i && distance(p, points[i]) < 1e-8)) fail('polygon_degenerate', '建筑轮廓不能有重复顶点', path);
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        if (segmentTouch(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) fail('polygon_self_intersection', '建筑轮廓不能自相交', path);
      }
    }
    let direction = 0, area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
      area += a.x * b.y - b.x * a.y;
      const turn = cross(a, b, c);
      if (Math.abs(turn) > 1e-9) {
        const sign = Math.sign(turn);
        if (direction && direction !== sign) fail('polygon_not_convex', '建筑必须是凸多边形；请将凹形建筑拆成多个凸形体块', path);
        direction = sign;
      }
    }
    if (!direction || Math.abs(area) < 1e-8) fail('polygon_degenerate', '建筑轮廓面积必须大于零', path);
    return points;
  }
  function location(value, path = 'location') {
    const supplied = value !== undefined;
    value = value ?? DEFAULT_LOCATION;
    object(value, path);
    const result = {
      latitude: number(value.latitude ?? DEFAULT_LOCATION.latitude, `${path}.latitude`, -90, 90),
      longitude: number(value.longitude ?? DEFAULT_LOCATION.longitude, `${path}.longitude`, -180, 180),
      timezone: number(value.timezone ?? DEFAULT_LOCATION.timezone, `${path}.timezone`, -14, 14)
    };
    for (const key of ['timezoneName', 'source', 'displayName', 'query']) if (value[key] !== undefined) result[key] = plainText(value[key], `${path}.${key}`, 500);
    if (result.timezoneName !== undefined) {
      try { new Intl.DateTimeFormat('en', { timeZone: result.timezoneName }).format(0); }
      catch { fail('invalid_timezone', '时区名称无效，请使用有效 IANA 时区', `${path}.timezoneName`); }
    }
    if (result.source === undefined) result.source = supplied ? 'user-provided' : 'unverified-default';
    return result;
  }
  function treeShape(value, path, defaults = DEFAULT_TREE) {
    object(value, path);
    const height = positive(value.height ?? defaults.height, `${path}.height`, 200);
    const radius = positive(value.radius ?? defaults.radius, `${path}.radius`, 100);
    const cost = positive(value.cost ?? defaults.cost, `${path}.cost`, 1000000);
    if (height < radius) fail('tree_shape', '树冠球心高度不能小于树冠半径', path);
    return { height, radius, cost };
  }
  function image(value, bounds) {
    const path = 'image'; object(value, path);
    if (typeof value.dataUrl !== 'string') fail('image_format', '底图必须是本地图片 data URL', path);
    if (value.dataUrl.length > Math.ceil(LIMITS.imageBytes / 3) * 4 + 64) fail('image_too_large', '图片不能超过 8 MiB', path);
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.dataUrl);
    if (!match || match[2].length % 4 !== 0) fail('image_format', '只接受内嵌的 PNG、JPEG 或 WebP 图片', path);
    const payload = match[2], padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    if (payload.length / 4 * 3 - padding > LIMITS.imageBytes) fail('image_too_large', '图片不能超过 8 MiB', path);
    let bytes;
    try { bytes = Array.from(atob(payload.slice(0, 48)), ch => ch.charCodeAt(0)); }
    catch { fail('image_format', '图片 base64 编码无效', path); }
    const type = match[1];
    const signature = type === 'png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
      : type === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.slice(0, 4).map(b => String.fromCharCode(b)).join('') === 'RIFF' && bytes.slice(8, 12).map(b => String.fromCharCode(b)).join('') === 'WEBP';
    if (!signature) fail('image_format', '图片内容与声明格式不一致', path);
    const pixelWidth = positive(value.pixelWidth, `${path}.pixelWidth`, LIMITS.imageSidePixels);
    const pixelHeight = positive(value.pixelHeight, `${path}.pixelHeight`, LIMITS.imageSidePixels);
    if (!Number.isInteger(pixelWidth) || !Number.isInteger(pixelHeight) || pixelWidth * pixelHeight > LIMITS.imagePixels) fail('image_dimensions', '图片像素尺寸无效或超过 1600 万像素', path);
    const widthMeters = positive(value.widthMeters, `${path}.widthMeters`, LIMITS.boundsMeters);
    if ((value.northRotation ?? 0) !== 0) fail('north_rotation', '当前仅支持北朝上的底图；请先旋转图片', path);
    if (Math.abs(widthMeters - bounds.width) > 1e-8 * Math.max(1, widthMeters) || Math.abs(bounds.height - widthMeters * pixelHeight / pixelWidth) > 1e-8 * Math.max(1, bounds.height)) fail('image_scale', '图片比例与校园米制尺寸不一致', path);
    return { dataUrl: value.dataUrl, pixelWidth, pixelHeight, widthMeters, northRotation: 0 };
  }
  function scenario(value, trees, loc, treeTemplate) {
    object(value, 'scenario'); object(value.settings ?? {}, 'scenario.settings');
    const raw = value.settings || {}, settings = { ...location({ ...loc, ...raw }, 'scenario.settings') };
    if (raw.date !== undefined) {
      if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) fail('scenario_invalid', '日期必须使用 YYYY-MM-DD 格式', 'scenario.settings.date');
      const date = new Date(`${raw.date}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw.date) fail('scenario_invalid', '日期不存在', 'scenario.settings.date');
      settings.date = raw.date;
    }
    if (raw.minutes !== undefined) settings.minutes = number(raw.minutes, 'scenario.settings.minutes', 0, 1440);
    if (raw.optimizationMode !== undefined && !['current', 'lunch'].includes(raw.optimizationMode)) fail('scenario_invalid', '未知优化模式', 'scenario.settings.optimizationMode');
    settings.optimizationMode = raw.optimizationMode || 'current';
    for (const key of ['airTemperature', 'relativeHumidity', 'windSpeed']) {
      if (raw[key] !== undefined) settings[key] = number(raw[key], `scenario.settings.${key}`, -1000, 1000);
    }
    const ids = new Set(trees.map(t => t.id));
    const added = array(value.addedTreeIds, 'scenario.addedTreeIds', LIMITS.trees).map((id, i) => {
      if (typeof id !== 'string' || !ids.has(id)) fail('scenario_id', '新增树标识必须对应校园中的树', `scenario.addedTreeIds[${i}]`);
      return id;
    });
    if (new Set(added).size !== added.length) fail('scenario_id', '新增树标识不能重复', 'scenario.addedTreeIds');
    const addedSet = new Set(added), expectedBaseline = trees.filter(t => !addedSet.has(t.id)).map(t => t.id);
    if (trees.some(tree => addedSet.has(tree.id) && tree.cost !== treeTemplate.cost)) fail('scenario_tree_cost', '当前模型的新树必须使用 treeTemplate 中的统一单价', 'scenario.addedTreeIds');
    if (value.baselineTreeIds !== undefined) {
      const baseline = array(value.baselineTreeIds, 'scenario.baselineTreeIds', LIMITS.trees);
      if (baseline.length !== expectedBaseline.length || new Set(baseline).size !== baseline.length || baseline.some(id => !expectedBaseline.includes(id))) fail('scenario_id', '既有树与新增树标识必须完整且互不重叠', 'scenario.baselineTreeIds');
    }
    const budget = number(value.budget, 'scenario.budget', 0, 1000000000);
    const result = { settings, budget, baselineTreeIds: expectedBaseline, addedTreeIds: added };
    if (value.spent !== undefined) result.spent = number(value.spent, 'scenario.spent', 0, 1000000000);
    // Derived metrics are intentionally not trusted or copied: the UI restores
    // this scenario with ShadeEngine and recomputes every result from its inputs.
    return result;
  }
  function validate(data) {
    inspect(data); object(data, 'campus');
    if (data.schemaVersion !== 1) fail('schema_version', '只支持 schemaVersion 为 1 的校园数据', 'schemaVersion');
    object(data.bounds, 'bounds');
    const bounds = { width: positive(data.bounds.width, 'bounds.width', LIMITS.boundsMeters), height: positive(data.bounds.height, 'bounds.height', LIMITS.boundsMeters) };
    const used = new Set();
    let inputPaths;
    if (data.paths !== undefined) inputPaths = array(data.paths, 'paths', LIMITS.paths);
    else {
      const legacy = array(data.route ?? [], 'route', LIMITS.pathPoints);
      inputPaths = legacy.length ? [{ id: 'legacy-route', name: '导入路线', points: legacy, width: 5, demand: 1 }] : [];
    }
    let pointCount = 0, totalLength = 0;
    const paths = inputPaths.map((path, index) => {
      const at = `paths[${index}]`; object(path, at);
      const points = array(path.points, `${at}.points`, LIMITS.pathPoints).map((p, i) => point(p, `${at}.points[${i}]`, bounds));
      if (points.length < 2) fail('path_too_short', '人行道至少需要两个点', at);
      pointCount += points.length;
      if (pointCount > LIMITS.pathPoints) fail('too_complex', '全部人行道合计最多 2048 个点', 'paths');
      for (let i = 1; i < points.length; i++) {
        const length = distance(points[i - 1], points[i]);
        if (length < 1e-6) fail('path_zero_length', '人行道相邻点不能重合', `${at}.points[${i}]`);
        totalLength += length;
      }
      if (totalLength > LIMITS.pathLengthMeters + 1e-8) fail('network_too_long', '全部输入人行道总长不能超过 10000 米', 'paths');
      return { id: identifier(path.id, `${at}.id`, used, `path-${index + 1}`), name: plainText(path.name ?? `人行道 ${index + 1}`, `${at}.name`), points, width: positive(path.width ?? 5, `${at}.width`, LIMITS.pathWidthMeters), demand: positive(path.demand ?? 1, `${at}.demand`, 1000) };
    });
    let buildingPoints = 0;
    const buildings = array(data.buildings ?? [], 'buildings', LIMITS.buildings).map((b, index) => {
      const at = `buildings[${index}]`; object(b, at);
      const outline = polygon(b.polygon, `${at}.polygon`, bounds); buildingPoints += outline.length;
      if (buildingPoints > LIMITS.buildingPoints) fail('too_complex', '建筑轮廓合计最多 2048 个顶点', 'buildings');
      const result = { id: identifier(b.id, `${at}.id`, used, `building-${index + 1}`), name: plainText(b.name ?? b.nameKey ?? `建筑 ${index + 1}`, `${at}.name`), height: positive(b.height, `${at}.height`, 300), polygon: outline };
      if (b.nameKey !== undefined) result.nameKey = plainText(b.nameKey, `${at}.nameKey`, 80);
      return result;
    });
    const treeTemplate = treeShape(data.treeTemplate ?? DEFAULT_TREE, 'treeTemplate');
    const trees = array(data.trees ?? [], 'trees', LIMITS.trees).map((tree, index) => {
      const at = `trees[${index}]`; object(tree, at);
      const result = { id: identifier(tree.id, `${at}.id`, used, `tree-${index + 1}`), ...point(tree, at, bounds), ...treeShape(tree, at, treeTemplate), existing: true };
      if (tree.name !== undefined) result.name = plainText(tree.name, `${at}.name`);
      if (tree.candidateSource !== undefined) result.candidateSource = plainText(tree.candidateSource, `${at}.candidateSource`, 80);
      if (tree.targetPathId !== undefined) result.targetPathId = plainText(tree.targetPathId, `${at}.targetPathId`, 80);
      if (tree.servicePathIds !== undefined) result.servicePathIds = [...new Set(array(tree.servicePathIds, `${at}.servicePathIds`, LIMITS.paths).map((id, i) => plainText(id, `${at}.servicePathIds[${i}]`, 80)))];
      for (const key of ['targetDistance', 'targetTime', 'targetX', 'targetY', 'normalOffset']) if (tree[key] !== undefined) result[key] = number(tree[key], `${at}.${key}`, -100000, 100000);
      return result;
    });
    const metadata = { title: '导入校园', provenance: 'user-provided', units: 'metres', axes: 'x east, y north', treeHeightMeaning: 'canopy centre above ground', measured: false };
    if (data.metadata !== undefined) {
      object(data.metadata, 'metadata');
      for (const key of ['name', 'campusName', 'title', 'provenance', 'weather', 'thermal', 'model', 'exportedAt', 'presetId', 'assumptions']) if (data.metadata[key] !== undefined) metadata[key] = plainText(data.metadata[key], `metadata.${key}`, 500);
      if (data.metadata.provisional !== undefined) metadata.provisional = data.metadata.provisional === true;
      if (data.metadata.pendingRecognition !== undefined) metadata.pendingRecognition = data.metadata.pendingRecognition === true;
    }
    const result = { schemaVersion: 1, metadata, bounds, paths, route: paths[0] ? paths[0].points.map(p => ({ ...p })) : [], buildings, trees, location: location(data.location), treeTemplate };
    if (data.image !== undefined) result.image = image(data.image, bounds);
    if (data.scenario !== undefined) {
      result.scenario = scenario(data.scenario, trees, result.location, treeTemplate);
      const added = new Set(result.scenario.addedTreeIds);
      for (const tree of result.trees) tree.existing = !added.has(tree.id);
      result.location = location(result.scenario.settings);
    }
    return result;
  }
  function parseJSON(text) {
    if (typeof text !== 'string') fail('invalid_type', '需要 JSON 文本');
    if (text.length > LIMITS.jsonBytes || new TextEncoder().encode(text).length > LIMITS.jsonBytes) fail('json_too_large', '校园 JSON 不能超过 16 MiB');
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { fail('invalid_json', 'JSON 格式无效，请检查逗号、引号和括号'); }
    return validate(parsed);
  }
  function fromImage({ dataUrl, pixelWidth, pixelHeight, widthMeters = 220, northRotation = 0, name, campusName } = {}) {
    positive(widthMeters, 'image.widthMeters', LIMITS.boundsMeters);
    positive(pixelWidth, 'image.pixelWidth', LIMITS.imageSidePixels);
    positive(pixelHeight, 'image.pixelHeight', LIMITS.imageSidePixels);
    const metadata = { title: name ?? '本地校园底图', provenance: 'local-image' };
    if (name !== undefined) metadata.name = name;
    if (campusName !== undefined) metadata.campusName = campusName;
    return validate({ schemaVersion: 1, metadata, bounds: { width: widthMeters, height: widthMeters * pixelHeight / pixelWidth }, paths: [], route: [], buildings: [], trees: [], treeTemplate: { ...DEFAULT_TREE }, image: { dataUrl, pixelWidth, pixelHeight, widthMeters, northRotation } });
  }
  root.ShadeCampusImport = Object.freeze({ parseJSON, validate, fromImage, limits: LIMITS, CampusImportError });
})(globalThis);
