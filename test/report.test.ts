import assert from 'node:assert/strict';
import test from 'node:test';
import { displayPath, interactiveHtml, isStorytellerReport, reportMessage, resolvePath } from '../src/web/lib/report.ts';

test('resolves paths a file refers to against its folder', () => {
  assert.equal(resolvePath('/data/output/report/index.md', 'figures/a.png'), '/data/output/report/figures/a.png');
  assert.equal(resolvePath('/data/output/report/index.md', './../b.png'), '/data/output/b.png');
  assert.equal(resolvePath('/data/output/report/index.md', '/data/input/c.csv'), '/data/input/c.csv');
  assert.equal(displayPath('/codeflower-state/workspace/plots/umap.png'), 'plots/umap.png');
});

test('puts the policy and the bridge before the report runs', () => {
  const html = interactiveHtml('<html><head><title>r</title><script>run()</script></head></html>');
  assert.ok(html.indexOf("default-src 'none'") < html.indexOf('run()'));
  assert.ok(html.indexOf('window.cfHost') < html.indexOf('run()'));
  assert.match(interactiveHtml('<p>bare</p>'), /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
  assert.ok(isStorytellerReport('<meta name="generator" content="storyteller 0.4">'));
});

test('accepts only the bridge messages from a report', () => {
  assert.deepEqual(reportMessage({ type: 'send', text: 'x'.repeat(30000) }), { type: 'send', text: 'x'.repeat(20000) });
  assert.deepEqual(reportMessage({ type: 'reload' }), { type: 'reload' });
  assert.equal(reportMessage({ type: 'comments', json: 1 }), undefined);
  assert.equal(reportMessage({ type: 'prompt', text: 'rm -rf' }), undefined);
  assert.equal(reportMessage('send'), undefined);
});
