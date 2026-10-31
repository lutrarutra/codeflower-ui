import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthMethod } from '@agentclientprotocol/sdk';
import { isApiKeyMethod, isTerminalMethod, isWebLink, signInPage } from '../src/web/lib/authMethods.ts';

test('reads how to sign in from the method the agent advertises', () => {
  const method = (fields: Record<string, unknown>) => ({ id: 'm', name: 'M', ...fields }) as AuthMethod;
  assert.equal(isTerminalMethod(method({ _meta: { 'terminal-auth': { command: 'login' } } })), true);
  assert.equal(isTerminalMethod(method({ type: 'terminal' })), true);
  assert.equal(isTerminalMethod(method({})), false);
  assert.equal(isApiKeyMethod(method({ _meta: { 'api-key': {} } })), true);
  assert.equal(isApiKeyMethod(method({ description: 'api-key' })), false);
});

test('opens only web links an agent sends', () => {
  assert.equal(isWebLink('https://example.com/device?code=1'), true);
  assert.equal(isWebLink('http://localhost:8080/callback'), true);
  assert.equal(isWebLink('javascript:alert(1)'), false);
  assert.equal(isWebLink('file:///etc/passwd'), false);
  assert.equal(isWebLink('not a url'), false);
});

test('finds the page a sign-in command prints, without its colors', () => {
  const output =
    'Opening browser to sign in…\r\nIf the browser didn\'t open, visit: \x1b[4mhttps://claude.com/cai/oauth/authorize?code=true&state=a%2Fb\x1b[24m\r\n\r\nPaste code here if prompted > ';
  assert.equal(signInPage(output), 'https://claude.com/cai/oauth/authorize?code=true&state=a%2Fb');
  assert.equal(signInPage('Go to https://auth.openai.com/device.\r\nThen enter ABCD-1234'), 'https://auth.openai.com/device');
  assert.equal(signInPage('Starting the sign-in…'), null);
  assert.equal(signInPage('see file:///etc/passwd'), null);
});
