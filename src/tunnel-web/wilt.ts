// The header's icon wilts while a plain tunnel page shows an error.

import { SAD_FLOWER_TILE_URL } from '../chat/lib/sadFlower.ts';

/** Puts the wilted flower in place of the header's icon, or the icon back. */
export function wilt(wilted: boolean): void {
  const icon = document.querySelector<HTMLImageElement>('header > img');
  if (icon) icon.src = wilted ? SAD_FLOWER_TILE_URL : '/icon.svg';
}
