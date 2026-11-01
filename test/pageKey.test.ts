import assert from 'node:assert/strict';
import test from 'node:test';
import { keyHeaders, takePageKey } from '../src/web/lib/pageKey.ts';

function place(search: string, stored: Record<string, string> = {}) {
  const replaced: string[] = [];
  return {
    replaced,
    stored,
    location: { search, pathname: '/', hash: '#chat' },
    history: { replaceState: (_data: unknown, _unused: string, url: string) => void replaced.push(url) },
    storage: { getItem: (name: string) => stored[name] ?? null, setItem: (name: string, value: string) => void (stored[name] = value) }
  };
}

test('takes the key out of the address, keeping the rest of the query', () => {
  const at = place('?key=s3cret&quit=1');
  assert.equal(takePageKey(at), 's3cret');
  assert.deepEqual(at.replaced, ['/?quit=1#chat']);
  assert.equal(at.stored['codeflower-key'], 's3cret');
  assert.deepEqual(keyHeaders(), { Authorization: 'Bearer s3cret' });
});

test('uses the kept key when the address has none, and leaves the address alone', () => {
  const at = place('', { 'codeflower-key': 'kept' });
  assert.equal(takePageKey(at), 'kept');
  assert.deepEqual(at.replaced, []);
  assert.equal(takePageKey(place('')), null);
  assert.deepEqual(keyHeaders(), {});
});
