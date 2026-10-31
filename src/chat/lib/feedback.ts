// Feedback the user sends from a preview tab, as the text the agent gets. It is
// plain text, so every agent understands it. Comments on parts of a figure name
// the SVG elements by id (as the codeflower-sketch skill asks figures to have)
// or the marked area in the file's own coordinates.
import type { FeedbackAnnotation, FeedbackElement, FeedbackFigure, FeedbackRegion } from '../../protocol/messages.ts';

export const MAX_ANNOTATIONS = 50;
const MAX_ELEMENTS = 20;
const MAX_COMMENT = 4000;
const MAX_ID = 100;
const MAX_LABEL = 80;

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';

const fraction = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

function checkedElements(value: unknown): FeedbackElement[] {
  if (!Array.isArray(value)) return [];
  const elements: FeedbackElement[] = [];
  for (const item of value.slice(0, MAX_ELEMENTS)) {
    if (!item || typeof item !== 'object') continue;
    const id = clean((item as FeedbackElement).id, MAX_ID);
    if (!id || elements.some((element) => element.id === id)) continue;
    const label = clean((item as FeedbackElement).label, MAX_LABEL);
    const tag = clean((item as FeedbackElement).tag, 40);
    elements.push({ id, ...(label ? { label } : {}), ...(tag ? { tag } : {}) });
  }
  return elements;
}

function checkedRegion(value: unknown): FeedbackRegion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const region = value as FeedbackRegion;
  const [x, y, width, height] = [fraction(region.x), fraction(region.y), fraction(region.width), fraction(region.height)];
  if (x === null || y === null || width === null || height === null) return undefined;
  const units = region.units;
  const numbers = units && [units.x, units.y, units.width, units.height].every((number) => typeof number === 'number' && Number.isFinite(number));
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
    ...(numbers && (units.unit === 'px' || units.unit === 'svg')
      ? { units: { x: units.x, y: units.y, width: units.width, height: units.height, unit: units.unit } }
      : {})
  };
}

/** The comments from a webview message, checked and trimmed; empty or malformed ones are dropped. */
export function feedbackAnnotations(value: unknown): FeedbackAnnotation[] {
  if (!Array.isArray(value)) return [];
  const annotations: FeedbackAnnotation[] = [];
  for (const item of value.slice(0, MAX_ANNOTATIONS)) {
    if (!item || typeof item !== 'object') continue;
    const comment = typeof item.comment === 'string' ? item.comment.trim().slice(0, MAX_COMMENT) : '';
    const elements = checkedElements(item.elements);
    const region = checkedRegion(item.region);
    if (!comment || (!elements.length && !region)) continue;
    annotations.push({ comment, ...(elements.length ? { elements } : {}), ...(region ? { region } : {}) });
  }
  return annotations;
}

/** The report figure from a webview message, checked and trimmed; undefined when there is none. */
export function feedbackFigure(value: unknown): FeedbackFigure | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const figure = value as FeedbackFigure;
  if (!Number.isSafeInteger(figure.index) || figure.index < 1) return undefined;
  const caption = clean(figure.caption, 200);
  const part = clean(figure.part, MAX_ID);
  const anchor = clean(figure.anchor, MAX_ID);
  return { index: figure.index, ...(caption ? { caption } : {}), ...(part ? { part } : {}), ...(anchor ? { anchor } : {}) };
}

/** How a report figure is named to the agent: `figure 3 ("UMAP of the cells", part umap)`. */
export function figureName(figure: FeedbackFigure): string {
  const details = [
    ...(figure.caption ? [`"${figure.caption}"`] : []),
    ...(figure.part ? [`part ${figure.part}`] : []),
    ...(figure.anchor && figure.anchor !== figure.part ? [`#${figure.anchor}`] : [])
  ];
  return `figure ${figure.index}${details.length ? ` (${details.join(', ')})` : ''}`;
}

/** How an element is named to the agent: `#mouse (Mouse)`. */
export function elementName(element: FeedbackElement): string {
  return element.label && element.label !== element.id ? `#${element.id} (${element.label})` : `#${element.id}`;
}

function joined(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const round = (number: number) => Math.round(number * 10) / 10;
const percent = (number: number) => `${Math.round(number * 100)}%`;

/** Where an area is: in the file's units when known, and as a share of the figure. */
export function regionName(region: FeedbackRegion): string {
  const share = `x ${percent(region.x)}–${percent(region.x + region.width)}, y ${percent(region.y)}–${percent(region.y + region.height)} of the figure`;
  const units = region.units;
  if (!units) return `the area at ${share}`;
  const where = `x ${round(units.x)}–${round(units.x + units.width)}, y ${round(units.y)}–${round(units.y + units.height)}`;
  return `the area at ${where} (${units.unit === 'px' ? 'image pixels' : 'SVG coordinates'}; ${share})`;
}

/** What a comment is about, for the agent and for the comment list. */
export function annotationTarget(annotation: FeedbackAnnotation): string {
  const parts = [];
  if (annotation.elements?.length) parts.push(joined(annotation.elements.map(elementName)));
  if (annotation.region) parts.push(regionName(annotation.region));
  return parts.join(' in ');
}

/**
 * The message for the chat: which file (and which of a report's figures),
 * where it was shown, the comments on its parts, then the general text.
 */
export function feedbackText(
  path: string,
  where: string,
  text: string,
  annotations: FeedbackAnnotation[] = [],
  figure?: FeedbackFigure
): string {
  const intro = figure
    ? `Feedback on ${figureName(figure)} in ${path}, which you showed me in ${where}:`
    : `Feedback on ${path}, which you showed me in ${where}:`;
  const comments = annotations.map((annotation, index) => {
    const [first = '', ...rest] = annotation.comment.split('\n');
    return [`${index + 1}. On ${annotationTarget(annotation)}: ${first}`, ...rest.map((line) => `   ${line}`)].join('\n');
  });
  return [intro, ...(comments.length ? [comments.join('\n')] : []), ...(text.trim() ? [text.trim()] : [])].join('\n\n');
}
