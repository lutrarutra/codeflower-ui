import assert from 'node:assert/strict';
import test from 'node:test';
import { effortLevels, matches, SEARCH_FROM, shownGroups, type SelectOption } from '../src/chat/lib/picker.ts';

// As OpenCode lists its models: flat, provider/model values, "Provider/Name" names.
const models: SelectOption = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'opencode/big-pickle',
  options: [
    { value: 'opencode/big-pickle', name: 'OpenCode/Big Pickle' },
    { value: 'openrouter/openrouter/free', name: 'OpenRouter/Free Models Router' },
    { value: 'openrouter/qwen/qwen3-32b', name: 'OpenRouter/Qwen3 32B' },
    { value: 'openrouter/google/gemma-4-31b-it:free', name: 'OpenRouter/Gemma 4 31B (free)', description: 'Google' }
  ]
};
const names = (groups: ReturnType<typeof shownGroups>) => groups.map((group) => [group.name, group.options.map((choice) => choice.value)]);

test('a search matches every word, in any order, in the name, description or value', () => {
  const [, , qwen, gemma] = models.options as { value: string; name: string; description?: string }[];
  assert.equal(matches(qwen, 'qwen'), true);
  assert.equal(matches(qwen, '32b QWEN'), true);
  assert.equal(matches(qwen, 'qwen 70b'), false);
  assert.equal(matches(gemma, 'google free'), true);
  assert.equal(matches(gemma, 'gemma-4-31b-it'), true);
  assert.equal(matches(gemma, '   '), true);
  assert.ok(SEARCH_FROM > models.options.length, 'a short list has no search box');
});

test('pinned models come first, in the list order, and stay in their group too', () => {
  assert.deepEqual(names(shownGroups(models, '')), [[null, models.options.map((choice) => (choice as { value: string }).value)]]);
  const pinned = shownGroups(models, '', ['openrouter/qwen/qwen3-32b', 'openrouter/openrouter/free', 'gone/model']);
  assert.deepEqual(names(pinned)[0], ['Pinned', ['openrouter/openrouter/free', 'openrouter/qwen/qwen3-32b']]);
  assert.equal(pinned[0].pinned, true);
  assert.equal(pinned[1].options.length, 4);
  // A search narrows both, and drops what is left empty.
  assert.deepEqual(names(shownGroups(models, 'qwen', ['openrouter/openrouter/free'])), [[null, ['openrouter/qwen/qwen3-32b']]]);
  assert.deepEqual(names(shownGroups(models, 'nothing like it', ['openrouter/openrouter/free'])), []);
});

test('grouped models (as dsh lists them) keep their groups', () => {
  const grouped: SelectOption = {
    ...models,
    options: [
      { group: 'deepseek', name: 'DeepSeek', options: [{ value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' }] },
      { group: 'compat', name: 'OpenAI-compatible', options: [{ value: '["codeflower-openai-compat","openrouter/free"]', name: 'openrouter/free' }] }
    ]
  };
  assert.deepEqual(names(shownGroups(grouped, 'free')), [['OpenAI-compatible', ['["codeflower-openai-compat","openrouter/free"]']]]);
  assert.deepEqual(names(shownGroups(grouped, '', ['["deepseek-official","deepseek-v4-flash"]'])).map(([name]) => name), ['Pinned', 'DeepSeek', 'OpenAI-compatible']);
});

// The efforts as the agents offer them: the default first (Claude Code's
// `default`, DSH's "Provider default" with an empty value) or last (OpenCode).
const effort = (options: { value: string; name: string }[], currentValue: string): SelectOption => ({
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  type: 'select',
  currentValue,
  options
});

test('effortLevels keeps the levels in order and sets the default apart, wherever the agent lists it', () => {
  const claude = effortLevels(
    effort(
      [
        { value: 'default', name: 'Default' },
        { value: 'low', name: 'Low' },
        { value: 'max', name: 'Max' }
      ],
      'default'
    )
  );
  assert.deepEqual(claude.levels.map((level) => level.value), ['low', 'max']);
  assert.equal(claude.byDefault?.name, 'Default');

  const dsh = effortLevels(
    effort(
      [
        { value: '', name: 'Provider default' },
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' }
      ],
      ''
    )
  );
  assert.deepEqual(dsh.levels.map((level) => level.value), ['low', 'high']);
  assert.equal(dsh.byDefault?.name, 'Provider default');

  const opencode = effortLevels(
    effort(
      [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
        { value: 'default', name: 'Default' }
      ],
      'low'
    )
  );
  assert.deepEqual(opencode.levels.map((level) => level.value), ['low', 'high']);
  assert.equal(opencode.byDefault?.value, 'default');

  // DSH's own models: Off is a level, the lowest, and there is no default.
  const native = effortLevels(
    effort(
      [
        { value: 'off', name: 'Off' },
        { value: 'low', name: 'Low' },
        { value: 'max', name: 'Max' }
      ],
      'max'
    )
  );
  assert.deepEqual(native.levels.map((level) => level.value), ['off', 'low', 'max']);
  assert.equal(native.byDefault, undefined);
});
