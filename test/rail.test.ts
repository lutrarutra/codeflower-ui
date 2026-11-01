import assert from 'node:assert/strict';
import test from 'node:test';
import type { Worker } from '../src/web/lib/api.ts';
import type { Machine } from '../src/web/lib/machines.svelte.ts';
import { badge, letters, machineColor, startState } from '../src/web/lib/rail.ts';

function worker(fields: Partial<Worker>): Worker {
  return { id: 'w', source: 'started', project: 'default', label: 'Claude Code', status: 'ready', ...fields } as Worker;
}

function machine(reach: Machine['reach'], capabilities?: { connect: boolean; start: boolean; connectOnly: boolean }): Machine {
  return { reach, system: capabilities ? { capabilities } : null } as unknown as Machine;
}

test('two letters: of the first two words, or the first two of one word', () => {
  assert.equal(letters('rnaseq-qc'), 'RQ');
  assert.equal(letters('grant figures 2'), 'GF');
  assert.equal(letters('atlas'), 'AT');
  assert.equal(letters('x'), 'X');
  assert.equal(letters('--'), '?');
});

test('a sandbox goes by its name, else its project, else its agent', () => {
  assert.equal(badge(worker({ name: 'methods draft', project: 'atlas' })), 'MD');
  assert.equal(badge(worker({ project: 'atlas' })), 'AT');
  assert.equal(badge(worker({})), 'CC');
  assert.equal(badge(worker({ source: 'added', project: 'atlas' })), 'CC');
});

test('a computer keeps its color wherever the page comes from', () => {
  const keys = ['b', '', 'a'];
  assert.equal(machineColor('a', keys), machineColor('a', ['a', 'b', '']));
  assert.notEqual(machineColor('a', keys), machineColor('b', keys));
});

test('starting through the tunnel shows locked until the computer allows it', () => {
  assert.equal(startState(machine('reachable', { connect: false, start: false, connectOnly: true })), 'locked');
  assert.equal(startState(machine('reachable', { connect: false, start: true, connectOnly: false })), 'ok');
  assert.equal(startState(machine('reachable', { connect: true, start: false, connectOnly: true })), 'connectOnly');
  assert.equal(startState(machine('reachable', { connect: true, start: false, connectOnly: false })), 'ok');
  assert.equal(startState(machine('offline')), 'offline');
  assert.equal(startState(machine('elsewhere')), 'unsupported');
  assert.equal(startState(machine('loading')), 'loading');
});
