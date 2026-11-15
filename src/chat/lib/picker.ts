// The choices of a select setting (ACP config option), as the pickers show them.
import type { SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk';

export type SelectOption = Extract<SessionConfigOption, { type: 'select' }>;

/** Options may come flat or in named groups. */
export function groups(option: SelectOption): { name: string | null; options: SessionConfigSelectOption[] }[] {
  const list = option.options;
  if (list.length && 'group' in list[0]) {
    return (list as { name: string; options: SessionConfigSelectOption[] }[]).map((group) => ({
      name: group.name,
      options: group.options
    }));
  }
  return [{ name: null, options: list as SessionConfigSelectOption[] }];
}

export function choices(option: SelectOption): SessionConfigSelectOption[] {
  return groups(option).flatMap((group) => group.options);
}

/**
 * Whether a choice leaves the setting to the agent or its provider rather
 * than naming a level: Claude Code's and OpenCode's `default`, DSH's
 * "Provider default" (an empty value). It is not a point on a scale.
 */
export function isDefaultChoice(choice: SessionConfigSelectOption): boolean {
  return choice.value === 'default' || choice.value === '';
}

/** An effort's levels, in the agent's order, and its default choice, if any. */
export function effortLevels(option: SelectOption): {
  levels: SessionConfigSelectOption[];
  byDefault: SessionConfigSelectOption | undefined;
} {
  const all = choices(option);
  return { levels: all.filter((choice) => !isDefaultChoice(choice)), byDefault: all.find(isDefaultChoice) };
}

/** Longer lists (e.g. OpenCode's hundreds of models) get a search box. */
export const SEARCH_FROM = 12;

/** Whether a choice has every word of the query in its name, description or value. */
export function matches(choice: SessionConfigSelectOption, query: string): boolean {
  const text = `${choice.name} ${choice.description ?? ''} ${choice.value}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/**
 * The groups shown for a query: the pinned choices first (in the list's
 * order), then every group with what matches, empty ones left out.
 */
export function shownGroups(
  option: SelectOption,
  query: string,
  favorites: readonly string[] = []
): { name: string | null; pinned: boolean; options: SessionConfigSelectOption[] }[] {
  const pinned = new Set(favorites);
  const all = groups(option).map((group) => ({ ...group, pinned: false, options: group.options.filter((choice) => matches(choice, query)) }));
  const first = all.flatMap((group) => group.options).filter((choice) => pinned.has(choice.value));
  return [...(first.length ? [{ name: 'Pinned', pinned: true, options: first }] : []), ...all.filter((group) => group.options.length)];
}
