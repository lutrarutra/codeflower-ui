import assert from 'node:assert/strict';
import test from 'node:test';
import { languageForName, languageForPath } from '../src/chat/lib/editor/languages.ts';

test('finds the language of a file from its name or extension, whatever its case', () => {
  const name = (path: string) => languageForPath(path)?.name;
  assert.equal(name('/codeflower-state/workspace/analysis.py'), 'Python');
  assert.equal(name('scripts/plot.R'), 'R');
  assert.equal(name('run.sh'), 'Shell');
  assert.equal(name('config.YAML'), 'YAML');
  assert.equal(name('pyproject.toml'), 'TOML');
  assert.equal(name('main.nf'), 'Groovy');
  assert.equal(name('workflow/Snakefile'), 'Python');
  assert.equal(name('Dockerfile'), 'Dockerfile');
  assert.equal(name('notebook.ipynb'), 'JSON');
  assert.equal(name('src/app.tsx'), 'TSX');
  assert.equal(name('notes.txt'), undefined);
  assert.equal(name('README'), undefined);
});

test("finds the language a fenced block names, with the aliases agents use", () => {
  const name = (info: string) => languageForName(info)?.name;
  assert.equal(name('python'), 'Python');
  assert.equal(name('py'), 'Python');
  assert.equal(name('bash'), 'Shell');
  assert.equal(name('console'), 'Shell');
  assert.equal(name('r'), 'R');
  assert.equal(name('ts title="a.ts"'), 'TypeScript');
  assert.equal(name('yml'), 'YAML');
  assert.equal(name('diff'), 'diff');
  assert.equal(name('nextflow'), 'Groovy');
  assert.equal(name(''), undefined);
  assert.equal(name('no-such-language'), undefined);
});
