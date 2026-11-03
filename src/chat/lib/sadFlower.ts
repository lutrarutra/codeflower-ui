// The code flower wilted, for errors and lost connections: the tulip's petals,
// stem and leaf hanging over a fallen petal and the blue dot. Markup, so the
// tunnel's plain pages draw it as the Svelte views do.

export const SAD_FLOWER_VIEWBOX = '10 14 78 68';

export const SAD_FLOWER_PATHS = `<g fill="none" stroke-linejoin="round" stroke-linecap="round">
<path d="M38 74C35 56 36 34 48 25C55 20 62 24 63 31" stroke="#1d1d1f" stroke-width="7.4"/>
<g transform="translate(36.4 54) rotate(-72) translate(-30 -53)" stroke="#1d1d1f" stroke-width="3">
<path d="M30 53C21 54 14 48 13 39c5-1 11 1 14 5 2 3 3 6 3 9Z" fill="#78b56a"/>
</g>
<path d="M38 74C35 56 36 34 48 25C55 20 62 24 63 31" stroke="#78b56a" stroke-width="2.6"/>
<g transform="translate(63 31) rotate(168) scale(0.92) translate(-32 -37)" stroke="#1d1d1f" stroke-width="3.4">
<path d="M32 37C22 38 15 30 17 15c6 3 11 9 15 22Z" fill="#ed9e4b"/>
<path d="M33 37C43 36 48 28 45 17c-6 2-10 8-12 20Z" fill="#e5483b"/>
<path d="M32 37C25 31 26 17 31 8c8 8 9 22 1 29Z" fill="#ffcf3f"/>
</g>
<circle cx="69.6" cy="65" r="2.9" fill="#2ec4f1" stroke="#1d1d1f" stroke-width="2.4"/>
<g transform="translate(58 72.5) rotate(-78) scale(0.62) translate(-33 -37)" stroke="#1d1d1f" stroke-width="4.4">
<path d="M33 37C43 36 48 28 45 17c-6 2-10 8-12 20Z" fill="#e5483b"/>
</g>
</g>`;

/** The flower on the clay tile of the icon, as an image for pages that do not know the theme. */
export const SAD_FLOWER_TILE_URL = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="27" fill="#f6efd9"/>` +
    `<svg x="8" y="12" width="80" height="70" viewBox="${SAD_FLOWER_VIEWBOX}">${SAD_FLOWER_PATHS}</svg></svg>`
)}`;
