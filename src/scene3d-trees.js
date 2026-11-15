(function (root) {
  'use strict';

  // All dimensions are in the same world units as the campus model.
  function create({THREE: T, world, track, trees, selected}) {
    const rows = trees || [];
    if (!rows.length) return;
    const dummy = new T.Object3D();
    const color = new T.Color();
    const up = new T.Vector3(0, 1, 0);
    const from = new T.Vector3();
    const to = new T.Vector3();
    const direction = new T.Vector3();
    const wood = track(new T.MeshStandardMaterial({color: 0x77634a, roughness: 1}));
    const leaves = track(new T.MeshStandardMaterial({color: 0xffffff, roughness: .94}));
    const branchGeometry = track(new T.CylinderGeometry(0.62, 1, 1, 5));
    const crownGeometry = track(new T.IcosahedronGeometry(1, 1));
    const leafGeometry = track(new T.IcosahedronGeometry(1, 0));
    function soften(geometry, amount) {
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const wobble = 1 + amount * Math.sin(x * 8.1 + y * 5.3 + z * 3.7);
        positions.setXYZ(i, x * wobble, y * wobble, z * wobble);
      }
      geometry.computeVertexNormals();
      // PolyhedronGeometry is non-indexed. Average coincident normals explicitly;
      // simply disabling flatShading still leaves large triangular lighting patches.
      const normals = geometry.attributes.normal, shared = new Map();
      const key = i => [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
      for (let i = 0; i < positions.count; i++) {
        const k = key(i), n = shared.get(k) || new T.Vector3();
        n.x += normals.getX(i);n.y += normals.getY(i);n.z += normals.getZ(i);shared.set(k, n);
      }
      for (const normal of shared.values()) normal.normalize();
      for (let i = 0; i < positions.count; i++) {const n = shared.get(key(i));normals.setXYZ(i, n.x, n.y, n.z);}
      geometry.computeBoundingSphere();
    }
    soften(crownGeometry, .075);soften(leafGeometry, .14);
    const branchCount = 13, coreCount = 3, leafCount = 42;
    const branches = track(new T.InstancedMesh(branchGeometry, wood, rows.length * branchCount));
    const crowns = track(new T.InstancedMesh(crownGeometry, leaves, rows.length * coreCount));
    const foliage = track(new T.InstancedMesh(leafGeometry, leaves, rows.length * leafCount));
    branches.castShadow = true;
    branches.receiveShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    world.add(branches, crowns, foliage);
    const addedCount = rows.filter(row => row.added).length;
    let rings;
    if (addedCount) {
      rings = track(new T.InstancedMesh(
        track(new T.RingGeometry(1.02, 1.16, 32)),
        track(new T.MeshBasicMaterial({color: 0xffffff, side: T.DoubleSide})), addedCount
      ));
      world.add(rings);
    }
    function random(seed) {
      const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
      return n - Math.floor(n);
    }
    function segment(index, x1, y1, z1, x2, y2, z2, width) {
      from.set(x1, y1, z1); to.set(x2, y2, z2);
      direction.subVectors(to, from);
      dummy.position.copy(from).add(to).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize());
      dummy.scale.set(width, direction.length(), width);
      dummy.updateMatrix();
      branches.setMatrixAt(index, dummy.matrix);
    }
    let ringIndex = 0;
    rows.forEach(({t, added}, i) => {
      const x = Number(t.x) || 0, z = -(Number(t.y) || 0);
      const r = Math.max(0.3, Number(t.radius) || 3);
      const h = Math.max(0.3, Number(t.height) || 6);
      let idSeed = 0;for (const character of String(t.id || 'tree')) idSeed = (idSeed * 31 + character.charCodeAt(0)) >>> 0;
      const seed = idSeed % 100003 + x * .17 + z * .23;
      const twist = random(seed) * Math.PI * 2;
      const fork = Math.max(.18, h - r * .7);
      const crownHeight = Math.min(r * (.73 + random(seed + 51) * .2), Math.max(r * .25, h - .2));
      const widthX = .87 + random(seed + 71) * .16, widthZ = .84 + random(seed + 73) * .2;
      // New planting uses a fresher foliage tone, without enlarging its crown
      // or changing its physical shadow to make the result seem stronger.
      const hue = added ? .315 + random(seed + 91) * .025 : .235 + random(seed + 91) * .055;
      const lightness = added ? .36 + random(seed + 97) * .055 : .29 + random(seed + 97) * .075;
      const saturation = added ? .53 : .33;
      const boughs = [];
      const trunkRadius = added
        ? Math.min(.25, Math.max(.18, r * .055), Number.isFinite(t.roadsideOffset) ? Math.max(.07, t.roadsideOffset - .05) : .25)
        : Math.max(.07, r * .07);
      segment(i * branchCount, x, 0, z, x + r * .025, fork + crownHeight * .4, z, trunkRadius);
      for (let j = 0; j < 6; j++) {
        const angle = twist + j * Math.PI / 3 + (random(seed + j + 1) - .5) * .42;
        const reach = r * (.37 + random(seed + j + 15) * .13);
        const bx = Math.cos(angle) * reach * widthX, bz = Math.sin(angle) * reach * widthZ;
        const by = (random(seed + j + 27) - .5) * crownHeight * .6;
        boughs.push({x: bx, y: by, z: bz, angle});
        segment(i * branchCount + j + 1, x, fork * (.87 + j * .016), z,
          x + bx, h + by, z + bz, Math.max(.035, r * .029));
        segment(i * branchCount + j + 7, x + bx * .65, h + by - crownHeight * .2, z + bz * .65,
          x + bx * 1.35, h + by + crownHeight * .2, z + bz * 1.35, Math.max(.018, r * .014));
      }
      // Small, smooth interior masses stop the canopy looking hollow, while the
      // outer 42 independently oriented sprays provide a broken leafy silhouette.
      for (let j = 0; j < coreCount; j++) {
        const angle = twist + j * Math.PI * 2 / coreCount;
        dummy.position.set(x + Math.cos(angle) * r * .21, h + crownHeight * (.03 + j * .055), z + Math.sin(angle) * r * .21);
        dummy.rotation.set(.1 * j, angle, -.08 * j);
        dummy.scale.set(r * .37 * widthX, crownHeight * .46, r * .34 * widthZ);
        dummy.updateMatrix();
        crowns.setMatrixAt(i * coreCount + j, dummy.matrix);
        crowns.setColorAt(i * coreCount + j, color.setHSL(hue, saturation, lightness * .92));
      }
      for (let j = 0; j < leafCount; j++) {
        const bough = boughs[j % boughs.length], spray = Math.floor(j / boughs.length);
        const azimuth = twist + spray * 2.399963 + random(seed + j * 11) * .8;
        const vertical = (spray / 6 * 2 - 1) * .83 + (random(seed + j * 13) - .5) * .22;
        const horizontal = Math.sqrt(Math.max(.08, 1 - vertical * vertical));
        const reach = r * (.2 + random(seed + j * 17) * .1);
        const size = r * (.18 + random(seed + j * 19) * .095);
        dummy.position.set(x + bough.x + Math.cos(azimuth) * horizontal * reach * widthX,
          h + bough.y + vertical * reach * (crownHeight / r),
          z + bough.z + Math.sin(azimuth) * horizontal * reach * widthZ);
        dummy.rotation.set((random(seed + j * 23) - .5) * .9, azimuth, (random(seed + j * 29) - .5) * .8);
        dummy.scale.set(size * (.95 + random(seed + j * 31) * .25),
          size * (.65 + random(seed + j * 37) * .35), size * (.75 + random(seed + j * 41) * .2));
        dummy.updateMatrix();foliage.setMatrixAt(i * leafCount + j, dummy.matrix);
        const variation = random(seed + j * 43);
        color.setHSL(hue + (variation - .5) * .025, saturation - .03 + variation * .12, lightness + (variation - .4) * .085);
        foliage.setColorAt(i * leafCount + j, color);
      }
      if (added) {
        dummy.position.set(x, 0.28, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(r, r, r);
        dummy.updateMatrix();
        rings.setMatrixAt(ringIndex, dummy.matrix);
        rings.setColorAt(ringIndex, color.set(t.id === selected ? 0xffad45 : 0x18d2b7));
        const number = ++ringIndex;
        const canvas = document.createElement('canvas');canvas.width = 192;canvas.height = 76;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = t.id === selected ? '#fff0cc' : '#ecfff6';ctx.fillRect(0, 0, 192, 76);
        ctx.strokeStyle = t.id === selected ? '#e2a535' : '#18b99d';ctx.lineWidth = 6;ctx.strokeRect(3, 3, 186, 70);
        ctx.fillStyle = '#185746';ctx.font = 'bold 34px sans-serif';ctx.textAlign = 'center';ctx.textBaseline = 'middle';ctx.fillText('新增 ' + String(number).padStart(2, '0'), 96, 39);
        const texture = track(new T.CanvasTexture(canvas));texture.colorSpace = T.SRGBColorSpace;
        const label = new T.Sprite(track(new T.SpriteMaterial({map: texture, transparent: true, depthWrite: false})));
        label.position.set(x, h + r + .65, z);label.scale.set(4.8, 1.9, 1);label.userData.treeId = t.id;
        world.add(label);
      }
    });
    branches.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    if (rings) {
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    }
  }
  root.ShadeSceneTrees = {create};
})(globalThis);
