import assert from 'node:assert/strict';
import test from 'node:test';
import { interactiveHtml, isStorytellerReport, printableHtml, reportMessage } from '../src/chat/lib/report.ts';
import { displayPath, resolvePath } from '../src/web/lib/report.ts';

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
  assert.deepEqual(reportMessage({ type: 'print', html: '<evil>' }), { type: 'print' });
  assert.equal(reportMessage({ type: 'comments', json: 1 }), undefined);
  assert.equal(reportMessage({ type: 'prompt', text: 'rm -rf' }), undefined);
  assert.equal(reportMessage('send'), undefined);
});

test('a clicked figure comes as its image, checked', () => {
  assert.deepEqual(reportMessage({ type: 'figure', src: 'data:image/png;base64,iVBO Rw0=', index: 2, caption: '  UMAP\n of cells ', part: 'umap' }), {
    type: 'figure',
    mimeType: 'image/png',
    data: 'iVBORw0=',
    figure: { index: 2, caption: 'UMAP of cells', part: 'umap' }
  });
  const svg = reportMessage({ type: 'figure', src: `data:image/svg+xml;utf8,${encodeURIComponent('<svg>é</svg>')}`, index: 1 });
  assert.equal(svg?.type === 'figure' && Buffer.from(svg.data, 'base64').toString(), '<svg>é</svg>');
  // Only images, with a number; nothing from elsewhere.
  assert.equal(reportMessage({ type: 'figure', src: 'data:text/html;base64,PGI+', index: 1 }), undefined);
  assert.equal(reportMessage({ type: 'figure', src: 'https://example.com/a.png', index: 1 }), undefined);
  assert.equal(reportMessage({ type: 'figure', src: 'data:image/png;base64,!!', index: 1 }), undefined);
  assert.equal(reportMessage({ type: 'figure', src: 'data:image/png;base64,iVBO', index: 0 }), undefined);
});

test('a printable copy has the policy and prints itself once loaded', () => {
  const html = printableHtml('<html><head></head><body><p>report</p></body></html>');
  assert.ok(html.indexOf("default-src 'none'") < html.indexOf('report'));
  assert.ok(html.indexOf('report') < html.indexOf('print()'));
  assert.ok(html.indexOf('print()') < html.indexOf('</body>'));
});
