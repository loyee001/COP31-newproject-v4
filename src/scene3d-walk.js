/* A connected, deterministic walk over the imported road graph.
   Ground shade uses the same opaque-canopy model as the planning engine. */
(function (root) {
  'use strict';
  const SPEED = 1.2, DEMO_SPEED = 6;
  const pointKey = p => Math.round(p.x * 1e6) + ',' + Math.round(p.y * 1e6);
  const routeCache = new Map();
  function chooseRoute(campus, E, comparisonTrees, planSolar) {
    const cacheKey = JSON.stringify([campus.bounds, campus.paths, campus.buildings, campus.trees, comparisonTrees, planSolar]);
    if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);
    function remember(route) {
      routeCache.set(cacheKey, route);
      if (routeCache.size > 4) routeCache.delete(routeCache.keys().next().value);
      return route;
    }
    const topology = E.network(campus), nodes = topology.nodes;
    if (!nodes.length || !topology.segments.length) return [];
    const byKey = new Map(nodes.map((n, i) => [pointKey(n), i]));
    const graph = nodes.map(() => []);
    const buildings = campus.buildings || [];
    const comparisonAvailable = comparisonTrees.length > 0 && planSolar?.altitude > 0;
    const baseShadow = comparisonAvailable ? E.shadows(campus, planSolar, campus.trees) : null;
    const extraShadow = comparisonAvailable ? E.shadows({...campus, buildings: []}, planSolar, comparisonTrees) : null;
    function newShadeAt(p) {
      return comparisonAvailable && !baseShadow.buildings.some(poly => E.pointInPolygon(p, poly))
        && !baseShadow.trees.some(ellipse => E.inEllipse(p, ellipse))
        && extraShadow.trees.some(ellipse => E.inEllipse(p, ellipse));
    }
    for (const edge of topology.segments) {
      // Recognition candidates can be imperfect; do not demonstrate a walk through a building.
      const steps = Math.max(1, Math.ceil(edge.length / 3));
      let obstructed = false;
      for (let s = 1; s < steps && !obstructed; s++) {
        const f = s / steps, p = {x: edge.a.x + (edge.b.x - edge.a.x) * f, y: edge.a.y + (edge.b.y - edge.a.y) * f};
        obstructed = buildings.some(b => E.pointInPolygon(p, b.polygon));
      }
      if (obstructed) continue;
      const a = byKey.get(pointKey(edge.a)), b = byKey.get(pointKey(edge.b));
      if (a === undefined || b === undefined) continue;
      let newShadeLength = 0;
      if (comparisonAvailable) for (let s = 0; s < steps; s++) {
        const f = (s + .5) / steps;
        if (newShadeAt({x: edge.a.x + (edge.b.x - edge.a.x) * f, y: edge.a.y + (edge.b.y - edge.a.y) * f})) newShadeLength += edge.length / steps;
      }
      graph[a].push({to: b, length: edge.length, newShadeLength});
      graph[b].push({to: a, length: edge.length, newShadeLength});
    }
    const W = campus.bounds.width, H = campus.bounds.height;
    const center = {x: W * .45, y: H * .64};
    const central = nodes.map((node, index) => ({index, d: Math.hypot(node.x - center.x, node.y - center.y)}))
      .filter(n => graph[n.index].length).sort((a, b) => a.d - b.d);
    // Start near actual new shade, then include the original central demonstration.
    // This selects a clearly labelled local example; it does not alter campus-wide scores.
    const improved = central.map(n => ({...n, gain: graph[n.index].reduce((sum, e) => sum + e.newShadeLength, 0)}))
      .filter(n => n.gain > 0).sort((a, b) => b.gain - a.gain || a.d - b.d).slice(0, 20);
    const starts = [...new Map(improved.concat(central.slice(0, improved.length ? 4 : 12)).map(n => [n.index, n])).values()];
    const nearTree = nodes.map(p => (campus.trees || []).some(t => Math.hypot(t.x - p.x, t.y - p.y) < t.radius + 14));
    let best = null;
    const minLength = Math.min(200, W * .22), maxLength = Math.min(350, W * .4), ideal = Math.min(285, W * .32);
    for (const {index: start} of starts) {
      const distances = nodes.map(() => Infinity), prev = nodes.map(() => -1), gains = nodes.map(() => 0), visited = new Uint8Array(nodes.length);
      distances[start] = 0;
      for (let step = 0; step < nodes.length; step++) {
        let current = -1, distance = Infinity;
        for (let i = 0; i < nodes.length; i++) if (!visited[i] && distances[i] < distance) {current = i; distance = distances[i];}
        if (current < 0 || distance > maxLength) break;
        visited[current] = 1;
        for (const edge of graph[current]) {
          const next = distance + edge.length;
          if (next < distances[edge.to] - 1e-7 || (Math.abs(next - distances[edge.to]) <= 1e-7 && gains[current] + edge.newShadeLength > gains[edge.to])) {distances[edge.to] = next; prev[edge.to] = current; gains[edge.to] = gains[current] + edge.newShadeLength;}
        }
      }
      for (let end = 0; end < nodes.length; end++) {
        const length = distances[end];
        if (length < minLength || length > maxLength) continue;
        const indices = [];
        for (let cursor = end; cursor !== -1; cursor = prev[cursor]) indices.push(cursor);
        indices.reverse();
        if (indices[0] !== start) continue;
        const junctions = indices.slice(1, -1).filter(i => graph[i].length >= 3).length;
        const route = indices.map(i => ({x: nodes[i].x, y: nodes[i].y}));
        // Before and after receive the same comparisonTrees and planSolar, so
        // both views follow the identical route and can preserve pedestrian progress.
        const nearby = indices.reduce((sum, index) => sum + Number(nearTree[index]), 0) / indices.length;
        const score = comparisonAvailable
          ? -gains[end] / length * 400 - gains[end] * .12 + Math.abs(length - ideal) * .018 - Math.min(junctions, 4)
          : Math.abs(length - ideal) * .15 - Math.min(junctions, 4) * 8 - nearby * 45
            + Math.hypot(nodes[start].x - center.x, nodes[start].y - center.y) * .1;
        if (!best || score < best.score) best = {score, route};
      }
    }
    if (best) return remember(best.route);
    // Small/disconnected imports may not have a 200 m route. A real edge is still safer than a shortcut.
    for (let a = 0; a < graph.length; a++) if (graph[a].length) {
      const b = graph[a].reduce((longest, edge) => edge.length > longest.length ? edge : longest).to;
      return remember([{x: nodes[a].x, y: nodes[a].y}, {x: nodes[b].x, y: nodes[b].y}]);
    }
    return remember([]);
  }
  function create({THREE: T, world, track, campus, trees, comparisonTrees, planSolar, phase = 'after'}) {
    const E = root.ShadeEngine, baselineIds = new Set((campus.trees || []).map(t => t.id));
    comparisonTrees = comparisonTrees || (trees || []).filter(t => !baselineIds.has(t.id));
    const route = chooseRoute(campus, E, comparisonTrees, planSolar);
    const group = new T.Group();world.add(group);
    const totalDistance = E.routeLength(route), samples = E.sampleRoute(route, 2.5);
    const routeId = route.map(pointKey).join('|');
    let distance = 0, playing = false, finished = false, disposed = false, accumulator = 0;
    let solar = {altitude: -1}, baselineProjection = {buildings: [], trees: []}, addedProjection = {buildings: [], trees: []}, shadeKind = 'night', shadePercent = null, baselinePercent = null, afterPercent = null;
    const register = object => {group.add(object);return object;};
    const material = (color, options = {}) => track(new T.MeshStandardMaterial({color, roughness: .85, ...options}));
    const basic = color => track(new T.MeshBasicMaterial({color}));
    const cyan = basic(0x46d9d5), white = basic(0xf0fff9), amber = basic(0xf0b263);
    const box = track(new T.BoxGeometry(1, 1, 1));
    function ribbon(width, y, mat) {
      if (route.length < 2) return;
      const segments = new T.InstancedMesh(box, mat, route.length - 1), dummy = new T.Object3D();
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i], dx = b.x - a.x, dz = a.y - b.y;
        dummy.position.set((a.x + b.x) / 2, y, -(a.y + b.y) / 2);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);dummy.scale.set(width, .025, Math.hypot(dx, dz));dummy.updateMatrix();
        segments.setMatrixAt(i - 1, dummy.matrix);
      }
      register(track(segments));
    }
    ribbon(.66, .235, white);
    // Subdivide each real road edge independently, keeping every junction corner.
    const colorSamples = [], coloredSegments = [];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(1, Math.ceil(length / 2));
      for (let j = 0; j < count; j++) {
        const f = (j + .5) / count;
        colorSamples.push({x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f});
        coloredSegments.push({a: {x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count}, b: {x: a.x + (b.x - a.x) * (j + 1) / count, y: a.y + (b.y - a.y) * (j + 1) / count}});
      }
    }
    let shadeRibbon = null;
    const shadeColors = {sun: 0xe4a546, tree: 0x35664c, building: 0x35664c, newTree: 0x20cdb5, night: 0x93a0ae};
    if (coloredSegments.length) {
      shadeRibbon = track(new T.InstancedMesh(box, basic(0xffffff), coloredSegments.length));
      const dummy = new T.Object3D(), color = new T.Color();
      coloredSegments.forEach(({a,b}, i) => {
        const dx = b.x - a.x, dz = a.y - b.y;
        dummy.position.set((a.x + b.x) / 2, .27, -(a.y + b.y) / 2);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);dummy.scale.set(.43, .025, Math.hypot(dx, dz));dummy.updateMatrix();
        shadeRibbon.setMatrixAt(i, dummy.matrix);shadeRibbon.setColorAt(i, color.set(shadeColors.night));
      });
      register(shadeRibbon);
    }
    function endpoint(point, label, mat) {
      const ring = new T.Mesh(track(new T.RingGeometry(1.25, 1.6, 32)), mat);
      ring.rotation.x = -Math.PI / 2;ring.position.set(point.x, .29, -point.y);register(ring);
      const canvas = document.createElement('canvas');canvas.width = 256;canvas.height = 96;
      const ctx = canvas.getContext('2d');ctx.fillStyle = '#fcfff7';ctx.fillRect(0, 0, 256, 96);
      ctx.fillStyle = '#294838';ctx.font = 'bold 42px sans-serif';ctx.textAlign = 'center';ctx.textBaseline = 'middle';ctx.fillText(label, 128, 48);
      const texture = track(new T.CanvasTexture(canvas));texture.colorSpace = T.SRGBColorSpace;
      const sprite = new T.Sprite(track(new T.SpriteMaterial({map: texture, transparent: true, depthWrite: false})));
      sprite.position.set(point.x, 3.6, -point.y);sprite.scale.set(5.6, 2.1, 1);register(sprite);
    }
    if (route.length > 1) {endpoint(route[0], '起点 A', cyan);endpoint(route[route.length - 1], '终点 B', amber);}
    const avatar = register(new T.Group()), torso = new T.Group();avatar.add(torso);
    const shirt = material(0x34586b), trousers = material(0xd4c7ac), skin = material(0xc8916e), shoe = material(0x303438), pack = material(0x5d4737);
    function part(parent, geometry, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
      const mesh = new T.Mesh(geometry, mat);mesh.position.set(x, y, z);mesh.scale.set(sx, sy, sz);mesh.castShadow = true;mesh.receiveShadow = true;parent.add(mesh);return mesh;
    }
    part(torso, box, shirt, 0, 1.12, 0, .38, .52, .23);
    part(torso, box, pack, 0, 1.12, -.19, .29, .37, .14);
    part(torso, track(new T.SphereGeometry(.13, 10, 8)), skin, 0, 1.6, 0);
    part(torso, track(new T.CylinderGeometry(.07, .07, .12, 6)), skin, 0, 1.43, 0);
    part(torso, box, trousers, 0, .83, 0, .33, .14, .23);
    const arms = [], legs = [];
    for (const side of [-1, 1]) {
      const arm = new T.Group();arm.position.set(side * .25, 1.34, 0);torso.add(arm);arms.push(arm);
      part(arm, box, shirt, 0, -.13, 0, .12, .28, .14);
      part(arm, box, skin, 0, -.39, .025, .085, .25, .1);
      const leg = new T.Group();leg.position.set(side * .105, .82, 0);torso.add(leg);legs.push(leg);
      part(leg, box, trousers, 0, -.32, 0, .14, .65, .17);
      part(leg, box, shoe, 0, -.68, .045, .16, .11, .28);
    }
    const positionMat = basic(0xf0b263);
    const positionRing = new T.Mesh(track(new T.RingGeometry(.57, .65, 24)), positionMat);
    positionRing.rotation.x = -Math.PI / 2;positionRing.position.y = .1;avatar.add(positionRing);
    function pointAlong(d) {
      let remaining = Math.max(0, d);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (remaining <= len || i === route.length - 1) {
          const f = Math.min(1, remaining / len);
          return {x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len};
        }
        remaining -= len;
      }
      return {...(route[0] || {x: 0, y: 0}), tx: 0, ty: 1};
    }
    function classify(p, after = phase !== 'before') {
      if (!(solar.altitude > 0)) return 'night';
      if (baselineProjection.buildings.some(poly => E.pointInPolygon(p, poly))) return 'building';
      if (baselineProjection.trees.some(ellipse => E.inEllipse(p, ellipse))) return 'tree';
      if (after && addedProjection.trees.some(ellipse => E.inEllipse(p, ellipse))) return 'newTree';
      return 'sun';
    }
    function updateAvatar() {
      const p = pointAlong(distance);avatar.position.set(p.x, .18, -p.y);avatar.rotation.y = Math.atan2(p.tx, -p.ty);
      const swing = playing ? Math.sin(distance / SPEED * 6) * .5 : 0;
      arms[0].rotation.x = -swing;arms[1].rotation.x = swing;legs[0].rotation.x = swing;legs[1].rotation.x = -swing;
      torso.position.y = playing ? Math.abs(Math.sin(distance / SPEED * 6)) * .025 : 0;
    }
    function updateShade() {
      shadeKind = classify(pointAlong(distance));
      positionMat.color.set(shadeKind === 'sun' ? 0xf0b263 : shadeKind === 'night' ? 0xa1b0cb : 0x43d3bd);
    }
    function updateSolar(next) {
      solar = next || {altitude: -1};
      baselineProjection = E.shadows(campus, solar, campus.trees);
      addedProjection = E.shadows({...campus, buildings: []}, solar, comparisonTrees);
      if (solar.altitude > 0 && totalDistance > 0) {
        let before = 0, after = 0;
        for (const sample of samples) {
          const original = classify(sample, false);
          if (original !== 'sun') {before += sample.weight;after += sample.weight;}
          else if (addedProjection.trees.some(ellipse => E.inEllipse(sample, ellipse))) after += sample.weight;
        }
        baselinePercent = Math.max(0, Math.min(100, before / totalDistance * 100));
        afterPercent = Math.max(0, Math.min(100, after / totalDistance * 100));
        shadePercent = phase === 'before' ? baselinePercent : afterPercent;
      } else baselinePercent = afterPercent = shadePercent = null;
      if (shadeRibbon) {
        const color = new T.Color();
        colorSamples.forEach((p, i) => shadeRibbon.setColorAt(i, color.set(shadeColors[classify(p)])));
        shadeRibbon.instanceColor.needsUpdate = true;
      }
      updateShade();
    }
    function seek(progress) {
      distance = Math.max(0, Math.min(1, Number(progress) || 0)) * totalDistance;
      finished = totalDistance > 0 && distance >= totalDistance;
      if (finished) playing = false;
      accumulator = 0;updateAvatar();updateShade();
    }
    updateAvatar();avatar.visible = totalDistance > 0;
    return {
      updateSolar, seek,
      tick(dt) {
        if (disposed || !playing || !totalDistance) return false;
        const elapsed = Math.max(0, Math.min(.25, Number(dt) || 0));
        distance = Math.min(totalDistance, distance + elapsed * SPEED * DEMO_SPEED);
        if (distance >= totalDistance) {finished = true;playing = false;}
        accumulator += elapsed;updateAvatar();
        if (accumulator >= .2 || finished) {accumulator = 0;updateShade();}
        return true;
      },
      setPlaying(value) {playing = !!value && !finished && totalDistance > 0;updateAvatar();},
      restart() {playing = false;seek(0);},
      getState() {
        return {playing, finished, progress: totalDistance ? distance / totalDistance : 0, distance, totalDistance,
          shaded: shadeKind === 'tree' || shadeKind === 'building' || shadeKind === 'newTree', shadeKind, speed: DEMO_SPEED,
          label: !totalDistance ? '暂无可通行路线' : ({sun: '阳光直晒', tree: '原有树荫', newTree: '新增树荫', building: '建筑阴影', night: '暂无太阳直射'})[shadeKind],
          startLabel: '起点 A', endLabel: '终点 B', shadePercent, baselinePercent, afterPercent, improvementPercent: afterPercent === null ? null : afterPercent - baselinePercent, routeId, routeLabel: comparisonTrees.length ? '优化示范路线' : '沿路步行'};
      },
      getFocus() {const p = pointAlong(distance);return {point: {x: p.x, y: 1, z: -p.y}, distance: 45};},
      getRoute() {return route.map(p => ({...p}));},
      getOutcomeFocus() {
        let best = null, run = [];
        const closeRun = () => {if (run.length && (!best || run.length > best.length)) best = run;run = [];};
        for (const sample of samples) {if (classify(sample, true) === 'newTree') run.push(sample);else closeRun();}closeRun();
        const point = best ? best[Math.floor(best.length / 2)] : samples.find(p => comparisonTrees.some(t => Math.hypot(t.x - p.x, t.y - p.y) < t.radius + 12));
        if (!point) return null;
        return {point: {x: point.x, y: 1, z: -point.y}, distance: 52, progress: totalDistance ? point.distance / totalDistance : 0};
      },
      dispose() {disposed = true;playing = false;world.remove(group);}
    };
  }
  root.ShadeSceneWalk = Object.freeze({create});
})(globalThis);
