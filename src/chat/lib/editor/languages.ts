// Which language a file or a fenced code block is in, for highlighting. The
// grammars come from @codemirror/language-data and load on first use, so a
// chat only fetches the ones it shows.
import type { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/** Names agents and pipelines use that language-data does not know by itself. */
const ALIASES: Record<string, string> = {
  console: 'shell',
  shellsession: 'shell',
  ipython: 'python',
  snakemake: 'python',
  nextflow: 'groovy',
  jsonc: 'json',
  ipynb: 'json'
};

/** Files named by convention, not by extension. */
const FILE_NAMES: Record<string, string> = {
  snakefile: 'python',
  'nextflow.config': 'groovy',
  '.bashrc': 'shell',
  '.profile': 'shell',
  '.env': 'properties files'
};

const EXTENSIONS: Record<string, string> = { nf: 'groovy', smk: 'python', ipynb: 'json', env: 'properties files' };

/** The language of a file, from its name; undefined for plain text. */
export function languageForPath(path: string): LanguageDescription | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const byName = FILE_NAMES[name.toLowerCase()];
  if (byName) return languageForName(byName);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (EXTENSIONS[extension]) return languageForName(EXTENSIONS[extension]);
  // language-data matches extensions as written: compare them lowercase.
  return languages.find(
    (language) => language.filename?.test(name) || (extension && language.extensions.includes(extension))
  );
}

/** The language of a fenced block's info string (```py, ```bash title=…), or of a name like "Python". */
export function languageForName(info: string): LanguageDescription | undefined {
  const word = info.trim().split(/[\s{,]/)[0]?.toLowerCase() ?? '';
  if (!word) return undefined;
  const name = (ALIASES[word] ?? word).toLowerCase();
  return languages.find(
    (language) =>
      language.name.toLowerCase() === name ||
      language.alias.includes(name) ||
      language.extensions.includes(name)
  );
}
