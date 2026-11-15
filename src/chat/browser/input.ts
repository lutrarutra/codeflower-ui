// From the browser view's DOM events to the page's input: where on the page
// a pointer is (the frame is scaled and letterboxed in the view), and which
// key or text goes. Pure, so both hosts and the tests share it.
import { MODIFIERS, type BrowserFrameMetadata, type BrowserInputEvent, type BrowserMouseButton } from '../../protocol/browser.ts';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the frame is drawn in the view: scaled to fit, centred (object-fit: contain). */
export function drawnArea(view: Box, image: { width: number; height: number }): Box {
  if (!image.width || !image.height || !view.width || !view.height) return { left: view.left, top: view.top, width: 0, height: 0 };
  const scale = Math.min(view.width / image.width, view.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { left: view.left + (view.width - width) / 2, top: view.top + (view.height - height) / 2, width, height };
}

/** A point in the view as the page's CSS pixels; undefined outside the frame. */
export function pagePoint(
  clientX: number,
  clientY: number,
  view: Box,
  image: { width: number; height: number },
  metadata: Pick<BrowserFrameMetadata, 'deviceWidth' | 'deviceHeight' | 'offsetTop'>
): { x: number; y: number } | undefined {
  const area = drawnArea(view, image);
  if (!area.width || !area.height) return undefined;
  const u = (clientX - area.left) / area.width;
  const v = (clientY - area.top) / area.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return undefined;
  return { x: Math.round(u * metadata.deviceWidth * 10) / 10, y: Math.round((v * metadata.deviceHeight - (metadata.offsetTop ?? 0)) * 10) / 10 };
}

interface Modifiable {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function modifiersOf(event: Modifiable): number {
  return (event.altKey ? MODIFIERS.alt : 0) | (event.ctrlKey ? MODIFIERS.ctrl : 0) | (event.metaKey ? MODIFIERS.meta : 0) | (event.shiftKey ? MODIFIERS.shift : 0);
}

const BUTTONS: BrowserMouseButton[] = ['left', 'middle', 'right', 'back', 'forward'];

/** A DOM pointer event's button, as CDP names it. */
export function buttonOf(button: number): BrowserMouseButton {
  return BUTTONS[button] ?? 'none';
}

interface KeyLike extends Modifiable {
  key: string;
  code: string;
  keyCode: number;
  location: number;
}

/** What a key press types into the page: printable keys, and Enter. */
export function typedText(event: KeyLike): string | undefined {
  if (event.ctrlKey || event.metaKey) return undefined;
  if (event.key === 'Enter') return '\r';
  return [...event.key].length === 1 ? event.key : undefined;
}

/**
 * Keys the view leaves to the user's own browser, so its paste and copy work:
 * the paste event brings the text, which goes as text.
 */
export function isClipboardKey(event: KeyLike): boolean {
  return (event.ctrlKey || event.metaKey) && ['v', 'c', 'x'].includes(event.key.toLowerCase());
}

export function keyEvent(action: 'down' | 'up', event: KeyLike): BrowserInputEvent {
  const text = action === 'down' ? typedText(event) : undefined;
  return {
    type: 'key',
    action,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    location: event.location,
    modifiers: modifiersOf(event),
    ...(text ? { text } : {})
  };
}

/** A wheel's delta in pixels, whatever unit the user's browser gave it in. */
export function wheelDelta(event: { deltaX: number; deltaY: number; deltaMode: number }, pageHeight: number): { deltaX: number; deltaY: number } {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  return { deltaX: event.deltaX * unit, deltaY: event.deltaY * unit };
}

/** Events to send, with pointer moves merged: only the latest move between two others goes. */
export function coalesce(events: BrowserInputEvent[]): BrowserInputEvent[] {
  const result: BrowserInputEvent[] = [];
  for (const event of events) {
    const last = result.at(-1);
    if (event.type === 'mouse' && event.action === 'move' && last?.type === 'mouse' && last.action === 'move') result[result.length - 1] = event;
    else result.push(event);
  }
  return result;
}
