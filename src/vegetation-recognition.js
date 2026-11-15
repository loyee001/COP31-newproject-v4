/* Local diagram vegetation proposals, not a trained botanical classifier.
 * Dark green compact crowns -> connected components -> distance peaks.
 * Light green lawns/fields remain a display mask and never become shade trees.
 * No DOM, uploads or network calls. All positions require user confirmation.
 */
(function (root) {
  'use strict';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function resize(image) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 16000000 || !image.data || image.data.length < image.width * image.height * 4) throw new Error('无效的校园图片像素');
    const scale = Math.min(1, 768 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sy = Math.min(image.height - 1, Math.floor((y + .5) * image.height / height));
      const sx = Math.min(image.width - 1, Math.floor((x + .5) * image.width / width));
      const source = (sy * image.width + sx) * 4, target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) rgba[target + channel] = image.data[source + channel];
    }
    return { rgba, width, height };
  }
  function components(mask, width, height) {
    const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length), output = [];
    for (let i = 0; i < mask.length; i++) if (mask[i] && !seen[i]) {
      let head = 0, tail = 1, x0 = width, y0 = height, x1 = 0, y1 = 0;
      queue[0] = i; seen[i] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % width, y = Math.floor(p / width);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
          const next = p + dy * width + dx;
          if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
        }
      }
      output.push({ pixels: Array.from(queue.subarray(0, tail)), x0, x1, y0, y1 });
    }
    return output;
  }
  function distanceField(mask, width, height) {
    const field = new Float32Array(mask.length), diagonal = Math.SQRT2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p]) field[p] = Math.min(x ? field[p - 1] + 1 : 1, y ? field[p - width] + 1 : 1, x && y ? field[p - width - 1] + diagonal : 1, x < width - 1 && y ? field[p - width + 1] + diagonal : 1);
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (mask[p]) field[p] = Math.min(field[p], x < width - 1 ? field[p + 1] + 1 : 1, y < height - 1 ? field[p + width] + 1 : 1, x < width - 1 && y < height - 1 ? field[p + width + 1] + diagonal : 1, x && y < height - 1 ? field[p + width - 1] + diagonal : 1);
    }
    return field;
  }
  function crownRadius(x, y, mask, width, height, maximum) {
    const radii = [];
    for (let direction = 0; direction < 16; direction++) {
      const angle = direction * Math.PI / 8, dx = Math.cos(angle), dy = Math.sin(angle);
      let radius = .5;
      for (; radius <= maximum; radius += .5) {
        const px = Math.round(x + dx * radius), py = Math.round(y + dy * radius);
        if (px < 0 || py < 0 || px >= width || py >= height || !mask[py * width + px]) break;
      }
      radii.push(radius);
    }
    radii.sort((a, b) => a - b);
    return { radius: (radii[7] + radii[8]) / 2, roundness: radii[3] / Math.max(1, radii[12]) };
  }
  function detect(imageData, { campusWidth = 220, campusHeight } = {}) {
    if (!Number.isFinite(campusWidth) || campusWidth <= 0 || campusWidth > 10000) throw new Error('校园米制宽度无效');
    const { rgba, width, height } = resize(imageData);
    campusHeight ??= campusWidth * imageData.height / imageData.width;
    if (!Number.isFinite(campusHeight) || campusHeight <= 0 || campusHeight > 10000) throw new Error('校园米制高度无效');
    const green = new Uint8Array(width * height), dark = new Uint8Array(width * height);
    let greenPixels = 0, darkPixels = 0;
    for (let p = 0; p < green.length; p++) {
      const i = p * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (rgba[i + 3] < 128) continue;
      if (g - r >= 9 && g - b >= 10 && g >= 65 && g <= 245 && r <= 225 && b <= 225) { green[p] = 1; greenPixels++; }
      if (g - r >= 18 && g - b >= 12 && g >= 55 && g <= 165 && r <= 150 && b <= 150) { dark[p] = 1; darkPixels++; }
    }
    const groups = components(dark, width, height), field = distanceField(dark, width, height), candidates = [];
    const maximumRadius = Math.max(8, Math.min(28, width * .04));
    let rejectedComponents = 0, splitComponents = 0;
    for (const group of groups) {
      const bw = group.x1 - group.x0 + 1, bh = group.y1 - group.y0 + 1;
      // Long fine dark-green outlines and tiny JPEG noise are not tree crowns.
      if (group.pixels.length < 7 || Math.min(bw, bh) < 3 || group.pixels.length > Math.PI * maximumRadius ** 2 * 6) { rejectedComponents++; continue; }
      const localMaxima = [];
      for (const p of group.pixels) {
        const radius = field[p];
        if (radius < 1.65 || radius > maximumRadius) continue;
        const x = p % width, y = Math.floor(p / width);
        let maximum = true;
        for (let dy = -1; dy <= 1 && maximum; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && field[p + dy * width + dx] > radius + .01) { maximum = false; break; }
        }
        if (maximum) localMaxima.push({ x, y, radius });
      }
      localMaxima.sort((a, b) => b.radius - a.radius || a.y - b.y || a.x - b.x);
      const peaks = [];
      for (const peak of localMaxima) if (!peaks.some(other => Math.hypot(peak.x - other.x, peak.y - other.y) < Math.max(2.6, .85 * (peak.radius + other.radius)))) peaks.push(peak);
      if (!peaks.length) { rejectedComponents++; continue; }
      if (peaks.length === 1 && (Math.max(bw, bh) / Math.min(bw, bh) > 2.6 || group.pixels.length / (bw * bh) < .32)) { rejectedComponents++; continue; }
      let accepted = 0;
      for (const peak of peaks) {
        const shape = crownRadius(peak.x, peak.y, dark, width, height, maximumRadius);
        if (shape.radius < 1.5 || shape.radius > maximumRadius || shape.roundness < .35) continue;
        let total = 0, support = 0, sumX = 0, sumY = 0;
        const search = Math.ceil(shape.radius);
        for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) {
          if (dx * dx + dy * dy > shape.radius * shape.radius) continue;
          const x = peak.x + dx, y = peak.y + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          total++;
          if (dark[y * width + x]) { support++; sumX += x; sumY += y; }
        }
        const fill = support / Math.max(1, total);
        if (support < 6 || fill < .55) continue;
        const x = support ? sumX / support : peak.x, y = support ? sumY / support : peak.y;
        candidates.push({ x, y, radius: shape.radius, confidence: clamp(.45 + .3 * fill + .2 * shape.roundness, .45, .95) });
        accepted++;
      }
      if (accepted > 1) splitComponents++;
      if (!accepted) rejectedComponents++;
    }
    candidates.sort((a, b) => b.confidence - a.confidence || a.y - b.y || a.x - b.x);
    const unique = [];
    for (const candidate of candidates) if (!unique.some(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) < .65 * (candidate.radius + other.radius))) unique.push(candidate);
    unique.sort((a, b) => a.y - b.y || a.x - b.x);
    const metresX = campusWidth / width, metresY = campusHeight / height;
    const trees = unique.map((candidate, index) => {
      const radius = candidate.radius * Math.sqrt(metresX * metresY);
      return { id: `recognized-tree-${index + 1}`, x: (candidate.x + .5) * metresX, y: (height - candidate.y - .5) * metresY, radius, height: Math.max(8, radius), cost: 95, existing: true, candidateSource: 'image-recognition', confidence: candidate.confidence };
    });
    const confidence = trees.length ? trees.reduce((sum, tree) => sum + tree.confidence, 0) / trees.length : greenPixels ? .35 : 0;
    return {
      trees, greenAreas: [], greenMask: { width, height, data: green }, confidence,
      diagnostics: { method: 'green-colour / compact-crown / distance-peak', width, height, treeCount: trees.length, greenPixels, greenCoverage: greenPixels / green.length, darkPixels, darkCoverage: darkPixels / green.length, rawComponents: groups.length, splitComponents, rejectedComponents, scaleAssumed: true, treeHeightAssumed: true, greenAreasAreShade: false, confidenceIsCalibratedProbability: false }
    };
  }
  root.ShadeVegetationRecognition = Object.freeze({ detect });
})(globalThis);
