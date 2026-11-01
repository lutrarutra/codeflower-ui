import assert from 'node:assert/strict';
import test from 'node:test';
import { externalUrl } from '../src/client/links.ts';

test('opens web pages only', () => {
  assert.equal(externalUrl('https://github.com/login/device')?.host, 'github.com');
  assert.equal(externalUrl(' http://127.0.0.1:1455/auth ')?.port, '1455');
  for (const link of ['vscode://vscode.git/clone?url=x', 'file:///etc/passwd', 'command:workbench.action.terminal.new', 'javascript:alert(1)', 'not a link']) {
    assert.equal(externalUrl(link), undefined, link);
  }
});
