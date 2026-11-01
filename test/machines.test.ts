import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseHead, compareVersions, fromLink, gone, PAGE_API, pageApiFits, qualify, splitId } from '../src/web/lib/machineIds.ts';

test('a sandbox on the tunnelled page names its computer; on the local page it does not', () => {
  assert.equal(qualify('local-3f2a', 'eu_k9x'), 'local-3f2a@eu_k9x');
  assert.equal(qualify('local-3f2a', undefined), 'local-3f2a');
  assert.deepEqual(splitId('local-3f2a@eu_k9x'), { id: 'local-3f2a', connectorId: 'eu_k9x' });
  assert.deepEqual(splitId('local-3f2a'), { id: 'local-3f2a' });
  // Not a connector after the @: the whole id is the computer's.
  assert.deepEqual(splitId('me@Host.example'), { id: 'me@Host.example' });
  assert.deepEqual(splitId('@abc'), { id: '@abc' });
});

test("a link without a computer is the head's, on the tunnelled page only", () => {
  assert.equal(fromLink('local-3f2a', 'eu_a'), 'local-3f2a@eu_a');
  assert.equal(fromLink('local-3f2a@eu_b', 'eu_a'), 'local-3f2a@eu_b');
  assert.equal(fromLink('local-3f2a', undefined), 'local-3f2a');
});

test('the page uses apps from its page API back to the oldest it knows', () => {
  assert.equal(pageApiFits(undefined), 'yes');
  assert.equal(pageApiFits(PAGE_API), 'yes');
  assert.equal(pageApiFits(PAGE_API + 1), 'newer');
});

test('app versions compare by their numbers; others compare equal', () => {
  assert.ok(compareVersions('0.17.0', '0.16.4') > 0);
  assert.ok(compareVersions('v0.16.0-3-gabc', '0.16.1') < 0);
  assert.equal(compareVersions('0.16.0', 'v0.16.0'), 0);
  assert.equal(compareVersions('dev', '0.16.0'), 0);
  assert.equal(compareVersions(undefined, '0.16.0'), 0);
});

test('the head is the computer with the newest page API, then the newest app; a tie stays', () => {
  const a = { connectorId: 'a', pageApi: 1, version: '0.16.0' };
  assert.equal(chooseHead('a', [a, { connectorId: 'b', pageApi: 2, version: '0.15.0' }]), 'b');
  assert.equal(chooseHead('a', [a, { connectorId: 'b', pageApi: 1, version: '0.17.0' }]), 'b');
  assert.equal(chooseHead('a', [a, { connectorId: 'b', pageApi: 1, version: '0.16.0' }]), 'a');
  assert.equal(chooseHead('a', [{ connectorId: 'b', pageApi: 1, version: 'dev' }, a]), 'a');
  // An app from before the page API is older than any that has one.
  assert.equal(chooseHead('a', [{ connectorId: 'a', version: '0.16.0' }, { connectorId: 'b', pageApi: 1, version: '0.15.0' }]), 'b');
  // The current computer's own answer is missing: it stays unless another is newer.
  assert.equal(chooseHead('a', [{ connectorId: 'b', version: '0.15.0' }]), 'a');
});

test('a sandbox goes when its own computer answers without it, not when another does or none does', () => {
  const of = (id: string) => splitId(id).connectorId ?? '';
  const listings = new Map<string, Set<string> | undefined>([
    ['a', new Set(['one@a'])],
    // b stopped answering: its last list stays.
    ['b', new Set(['two@b'])],
    // c has not answered yet.
    ['c', undefined]
  ]);
  assert.deepEqual(gone(['one@a', 'old@a', 'two@b', 'three@c', 'four@d', 'unqualified'], listings, of), ['old@a', 'four@d', 'unqualified']);
});
