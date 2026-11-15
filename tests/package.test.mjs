import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

await import('../build.mjs');

test('all deliverable copies contain identical self-contained HTML', async () => {
  const pages = await Promise.all([
    '../ShadePath-preview.html', '../preview/ShadePath-preview.html', '../dist/index.html',
  ].map((name) => readFile(new URL(name, import.meta.url), 'utf8')));
  assert.equal(pages[0], pages[1]);
  assert.equal(pages[0], pages[2]);
  assert.match(pages[0], /<!doctype html>/i);
  assert.doesNotMatch(pages[0], /<!--(?:STYLES|SCRIPTS)-->/);
  assert.doesNotMatch(pages[0], /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(pages[0], /<link\b[^>]*rel=["']stylesheet["']/i);
  assert.doesNotMatch(pages[0], /@import\s+(?:url\()?\s*["']?https?:/i);
  assert.doesNotMatch(pages[0], /<img\b[^>]*\bsrc=["']https?:/i);
});

test('inlined scripts remain valid classic JavaScript after HTML packaging', async () => {
  const html = await readFile(new URL('../ShadePath-preview.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)];
  assert.equal(scripts.length, 14);
  scripts.forEach((match, index) => assert.doesNotThrow(() => new Script(match[1], { filename: `inline-${index}.js` })));
});
