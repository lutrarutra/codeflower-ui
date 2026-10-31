// Selecting elements of an SVG figure to comment on them. The SVG is sanitized
// (no scripts, handlers, foreign content or outside references) before it is
// drawn inline, so its elements can be clicked.
import DOMPurify from 'dompurify';
import type { FeedbackElement } from '../../protocol/messages.ts';

// Only the file's own fragments and embedded images; nothing is fetched.
const SAFE_REFERENCE = /^(#|data:image\/(png|jpeg|gif|webp|svg\+xml)[;,])/i;

let purifier: ReturnType<typeof DOMPurify> | undefined;

/** The SVG markup, safe to draw inline in a shadow root. */
export function sanitizeSvg(text: string): string {
  if (!purifier) {
    // An instance of its own: the hook must not apply to HTML reports.
    purifier = DOMPurify();
    purifier.addHook('uponSanitizeAttribute', (_node, data) => {
      if ((data.attrName === 'href' || data.attrName === 'xlink:href') && !SAFE_REFERENCE.test(data.attrValue.trim())) {
        data.keepAttr = false;
      }
    });
  }
  return purifier.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script'],
    // Ids name the elements; the shadow root keeps them from clobbering the document.
    SANITIZE_DOM: false
  });
}

/** One element on the way from the clicked shape up to the figure's root. */
export interface Ancestor {
  id: string | null;
  label: string | null;
}

/**
 * Which ancestor a click selects, innermost first: the nearest with a
 * data-label (an icon's group rather than a path inside it), else the nearest
 * with an id; -1 when none has either.
 */
export function chooseSelectable(chain: Ancestor[]): number {
  const labelled = chain.findIndex((item) => item.id && item.label);
  return labelled >= 0 ? labelled : chain.findIndex((item) => item.id);
}

/** The selectable element for a click inside the figure, or null. */
export function selectableElement(target: EventTarget | null, figure: SVGSVGElement): SVGElement | null {
  const chain: SVGElement[] = [];
  for (let node = target as Element | null; node && node !== figure; node = node.parentElement) {
    if (node instanceof SVGElement) chain.push(node);
  }
  const index = chooseSelectable(chain.map((node) => ({ id: node.getAttribute('id'), label: node.getAttribute('data-label') })));
  return index >= 0 ? chain[index]! : null;
}

export function describeElement(element: SVGElement): FeedbackElement {
  const label = element.getAttribute('data-label')?.trim();
  return { id: element.getAttribute('id') ?? '', ...(label ? { label } : {}), tag: element.tagName };
}
