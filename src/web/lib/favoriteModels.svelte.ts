// The models the user pinned in the model picker, by agent (their values are
// the agent's own), kept in browser storage for every chat and sandbox.

const KEY = 'codeflower.favoriteModels';

function stored(): Record<string, string[]> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export const favoriteModels = $state<Record<string, string[]>>(stored());

export function setFavoriteModel(agent: string | undefined, value: string, pinned: boolean): void {
  if (!agent) return;
  const others = (favoriteModels[agent] ?? []).filter((model) => model !== value);
  favoriteModels[agent] = pinned ? [...others, value] : others;
  try {
    localStorage.setItem(KEY, JSON.stringify(favoriteModels));
  } catch {
    // Not kept, e.g. in a private window.
  }
}
