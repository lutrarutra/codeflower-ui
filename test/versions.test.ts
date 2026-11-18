import assert from 'node:assert/strict';
import { test } from 'node:test';
import { versionLines, versionText } from '../src/web/lib/versions.ts';

test('a client page says who serves it, then what the sandbox reports', () => {
  const lines = versionLines({
    ui: '0.33.0',
    server: { kind: 'client', version: 'v0.40.0', computer: 'laptop', address: '127.0.0.1:7710' },
    versions: {
      app: 'v0.39.0',
      image: '0.33.0',
      imageRef: 'ghcr.io/lutrarutra/codeflower-sandbox:0.33.0',
      page: '0.33.0',
      storyteller: '0.6.3',
      agents: { opencode: '1.19.5', claude: '2.1.310' }
    },
    agentName: (id) => ({ claude: 'Claude Code', opencode: 'OpenCode' })[id] ?? id
  });
  assert.equal(
    versionText(lines),
    [
      'This page: ui 0.33.0 (served by code flower 0.40.0 on laptop at 127.0.0.1:7710)',
      'Started by: code flower 0.39.0',
      'Sandbox image: 0.33.0 (ghcr.io/lutrarutra/codeflower-sandbox:0.33.0)',
      'Its page: ui 0.33.0 (what the image serves with --server)',
      'storyteller: 0.6.3',
      'Claude Code: 2.1.310',
      'OpenCode: 1.19.5'
    ].join('\n')
  );
});

test("a sandbox's own page, and one through the tunnel listed by another computer", () => {
  assert.deepEqual(versionLines({ ui: '0.33.0', server: { kind: 'sandbox' } }), [
    { label: 'This page', value: 'ui 0.33.0', detail: 'served by this sandbox (--server), from its image' }
  ]);
  const tunnel = versionLines({
    ui: '0.33.0',
    server: { kind: 'client', version: '', computer: 'laptop' },
    lister: { computer: 'cluster', version: 'v0.38.0' },
    versions: { imageRef: '/home/me/codeflower/images/custom.sif' }
  });
  assert.deepEqual(tunnel, [
    { label: 'This page', value: 'ui 0.33.0', detail: 'served by code flower on laptop through the tunnel' },
    { label: 'Listed by', value: 'code flower 0.38.0', detail: 'on cluster' },
    { label: 'Sandbox image', value: 'unknown release', detail: '/home/me/codeflower/images/custom.sif' }
  ]);
});
