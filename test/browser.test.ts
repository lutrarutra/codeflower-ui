import assert from 'node:assert/strict';
import test from 'node:test';
import { buttonOf, coalesce, drawnArea, isClipboardKey, keyEvent, modifiersOf, pagePoint, typedText, wheelDelta } from '../src/chat/browser/input.ts';

Reflect.set(globalThis, '$state', Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T): T => structuredClone(value) }));
const { Workbench, browserKeyOf, browserTab, chatTab, splitTab, tabOf } = await import('../src/web/lib/workbench.svelte.ts');

const metadata = { deviceWidth: 1280, deviceHeight: 800, offsetTop: 0 };
const key = (key: string, extra: Partial<{ code: string; keyCode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  code: extra.code ?? '',
  keyCode: extra.keyCode ?? 0,
  location: 0,
  altKey: extra.altKey ?? false,
  ctrlKey: extra.ctrlKey ?? false,
  metaKey: extra.metaKey ?? false,
  shiftKey: extra.shiftKey ?? false
});

test('maps a point in the letterboxed view to the page\'s pixels', () => {
  // A 1280×800 frame in a 640×600 view: scaled by a half, 100 px bars above and below.
  const view = { left: 10, top: 20, width: 640, height: 600 };
  assert.deepEqual(drawnArea(view, { width: 1280, height: 800 }), { left: 10, top: 120, width: 640, height: 400 });
  assert.deepEqual(pagePoint(10, 120, view, { width: 1280, height: 800 }, metadata), { x: 0, y: 0 });
  assert.deepEqual(pagePoint(330, 320, view, { width: 1280, height: 800 }, metadata), { x: 640, y: 400 });
  // In the bars: not on the page.
  assert.equal(pagePoint(330, 60, view, { width: 1280, height: 800 }, metadata), undefined);
  // A frame scaled down by the sandbox (maxWidth) still maps to the page's CSS pixels.
  assert.deepEqual(pagePoint(330, 320, view, { width: 640, height: 400 }, metadata), { x: 640, y: 400 });
  assert.equal(pagePoint(1, 1, view, { width: 0, height: 0 }, metadata), undefined);
});

test('types printable keys and Enter, and leaves the clipboard\'s keys to the user\'s browser', () => {
  assert.equal(typedText(key('a')), 'a');
  assert.equal(typedText(key('é')), 'é');
  assert.equal(typedText(key('Enter')), '\r');
  assert.equal(typedText(key('Backspace')), undefined);
  assert.equal(typedText(key('a', { ctrlKey: true })), undefined);
  assert.deepEqual(keyEvent('down', key('A', { code: 'KeyA', keyCode: 65, shiftKey: true })), {
    type: 'key',
    action: 'down',
    key: 'A',
    code: 'KeyA',
    keyCode: 65,
    location: 0,
    modifiers: 8,
    text: 'A'
  });
  assert.equal((keyEvent('up', key('a')) as { text?: string }).text, undefined);
  assert.equal(isClipboardKey(key('v', { ctrlKey: true })), true);
  assert.equal(isClipboardKey(key('V', { metaKey: true })), true);
  assert.equal(isClipboardKey(key('v')), false);
  assert.equal(modifiersOf({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: true }), 11);
  assert.equal(buttonOf(0), 'left');
  assert.equal(buttonOf(2), 'right');
  assert.equal(buttonOf(9), 'none');
});

test('scrolls by pixels whatever the wheel counts in, and sends only the latest of several moves', () => {
  assert.deepEqual(wheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800), { deltaX: 0, deltaY: 48 });
  assert.deepEqual(wheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800), { deltaX: 0, deltaY: 800 });
  const move = (x: number) => ({ type: 'mouse' as const, action: 'move' as const, x, y: 0, button: 'none' as const, buttons: 0, clickCount: 0, modifiers: 0 });
  const down = { ...move(3), action: 'down' as const, button: 'left' as const, clickCount: 1 };
  assert.deepEqual(coalesce([move(1), move(2), down, move(4), move(5)]), [move(2), down, move(5)]);
});

test('opens a chat\'s browser beside the chat, and in front when the agent asks for the user', () => {
  const workbench = new Workbench();
  workbench.openChat('one', 'claude-1');
  const chat = tabOf('one', chatTab('claude-1'));
  const browser = tabOf('one', browserTab('claude-1'));
  assert.equal(browserKeyOf(splitTab(browser).local), 'claude-1');
  assert.equal(browserKeyOf('chat:claude-1'), undefined);

  // Beside the chat, without taking the focus from it.
  workbench.openBrowser('one', 'claude-1', false);
  assert.notEqual(workbench.layout.groupOf(browser)!.id, workbench.layout.groupOf(chat)!.id);
  assert.deepEqual(workbench.focusedChat(), { workerId: 'one', key: 'claude-1' });
  assert.equal(workbench.layout.focused, workbench.layout.groupOf(chat)!.id);

  // A handoff brings it to the front, focused; opening it again adds no tab.
  workbench.openFile('one', '/work/plot.png');
  workbench.openBrowser('one', 'claude-1', true);
  assert.equal(workbench.layout.tabs().filter((tab) => tab === browser).length, 1);
  assert.equal(workbench.layout.groupOf(browser)!.active, browser);
  assert.equal(workbench.layout.focused, workbench.layout.groupOf(browser)!.id);
});
