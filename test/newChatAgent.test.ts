import assert from 'node:assert/strict';
import test from 'node:test';
import { newChatAgent, rememberAgent } from '../src/web/lib/newChatAgent.ts';
import { agentState } from './fakeAgent.ts';

// The page keeps the choice in localStorage, which Node has not: a stand-in.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) }
});

test('a new chat starts with the chosen agent, then the remembered one, else the first that can run and is signed in', () => {
  const agents = [
    agentState('claude', { unavailable: 'Claude Code is not installed in this sandbox.' }),
    agentState('codex', { signedIn: false }),
    agentState('dsh')
  ];
  assert.equal(newChatAgent(agents, 'study'), 'dsh');
  assert.equal(newChatAgent(agents, 'study', 'opencode'), 'dsh');
  // One that cannot run here, or is not signed in, is never chosen.
  assert.equal(newChatAgent(agents, 'study', 'claude'), 'dsh');
  assert.equal(newChatAgent(agents, 'study', 'codex'), 'dsh');
  rememberAgent('study', 'opencode');
  assert.equal(newChatAgent([...agents, agentState('opencode')], 'study'), 'opencode');
  assert.equal(newChatAgent([...agents, agentState('opencode')], 'other'), 'dsh');
  // None signed in: none.
  assert.equal(newChatAgent([agentState('codex', { signedIn: false })], 'x'), undefined);
  assert.equal(newChatAgent([], 'x'), undefined);
});
