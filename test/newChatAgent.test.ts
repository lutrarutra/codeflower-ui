import assert from 'node:assert/strict';
import test from 'node:test';
import { newChatAgent, rememberAgent } from '../src/web/lib/newChatAgent.ts';
import { agentState } from './fakeAgent.ts';

// The page keeps the choice in localStorage, which Node has not: a stand-in.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) }
});

test('a new chat starts with the chosen agent, then the remembered one, else the first signed in that can run', () => {
  const agents = [
    agentState('claude', { unavailable: 'Claude Code is not installed in this sandbox.' }),
    agentState('codex', { signedIn: false }),
    agentState('dsh')
  ];
  assert.equal(newChatAgent(agents, 'study'), 'dsh');
  assert.equal(newChatAgent(agents, 'study', 'codex'), 'codex');
  // One that cannot run here is never chosen.
  assert.equal(newChatAgent(agents, 'study', 'claude'), 'dsh');
  rememberAgent('study', 'codex');
  assert.equal(newChatAgent(agents, 'study'), 'codex');
  assert.equal(newChatAgent(agents, 'other'), 'dsh');
  // None signed in: the first that can run.
  assert.equal(newChatAgent([agentState('codex', { signedIn: false })], 'x'), 'codex');
  assert.equal(newChatAgent([], 'x'), undefined);
});
