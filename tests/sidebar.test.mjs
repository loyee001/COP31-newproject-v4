import test from 'node:test';
import assert from 'node:assert/strict';

await import('../src/sidebar.js');
const { clampWidth } = globalThis.ShadeSidebar;

test('sidebar clamp never exceeds half the page, including odd viewport widths', () => {
  for (const viewport of [0, 1, 200, 390, 599, 600, 620, 627, 999, 1000, 1440, 2560]) {
    for (const requested of [-100, 0, 176, 250, 280, 313.5, 500, 10000, Infinity, NaN]) {
      const width = clampWidth(requested, viewport);
      assert.ok(width >= 0);
      assert.ok(width <= viewport / 2, `${width}px exceeds half of ${viewport}px`);
      assert.equal(width, Math.floor(width));
    }
    assert.equal(clampWidth(100000, viewport), Math.floor(viewport / 2));
  }
});

test('sidebar preserves a 250px default and usable desktop minimum', () => {
  assert.equal(clampWidth(NaN, 627), 250);
  assert.equal(clampWidth(Infinity, 627), 250);
  assert.equal(clampWidth(undefined, 627), 250);
  assert.equal(clampWidth(250, 627), 250);
  assert.equal(clampWidth(280, 627), 280);
  assert.equal(clampWidth(10, 627), 176);
  assert.equal(clampWidth(1000, 627), 313);
  assert.equal(clampWidth(1000, 620), 310);
  assert.equal(clampWidth(1000, 1440), 720);
});

test('saved width is reclamped after the page becomes narrower', () => {
  const saved = clampWidth(650, 1440);
  assert.equal(saved, 650);
  assert.equal(clampWidth(saved, 620), 310);
  assert.equal(clampWidth(saved, 600), 300);
});
