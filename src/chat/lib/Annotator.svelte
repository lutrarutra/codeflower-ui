<script module lang="ts">
  import type { FeedbackAnnotation } from '../../protocol/messages.ts';

  /** A comment being written on a part of the figure. */
  export interface Note extends FeedbackAnnotation {
    key: number;
  }
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { FeedbackElement, FeedbackRegion } from '../../protocol/messages.ts';
  import { annotationTarget, elementName } from './feedback.ts';
  import { decodeText } from './files.ts';
  import { describeElement, sanitizeSvg, selectableElement } from './svgSelect.ts';

  // The figure over the whole tab: the user clicks SVG elements or drags over an
  // area, writes a comment for each, and sends them all to the agent at once.
  // It opens fitted to the space and can be zoomed and moved around.
  let {
    title,
    subtitle = '',
    mimeType,
    data,
    notes = $bindable(),
    general = $bindable(),
    sendable,
    sendHint,
    onsend,
    onclose,
    ondownload
  }: {
    title: string;
    /** Where the figure is, e.g. its place in a report. */
    subtitle?: string;
    mimeType: string;
    /** The figure, base64. */
    data: string;
    notes: Note[];
    general: string;
    /** A chat is there to take the comments. */
    sendable: boolean;
    sendHint: string;
    onsend: (text: string, annotations: FeedbackAnnotation[]) => void;
    onclose: () => void;
    /** Saves a copy of the figure on this machine; no button without it. */
    ondownload?: () => void;
  } = $props();

  // Dragging less than this is a click.
  const DRAG_PIXELS = 5;
  // Room around the fitted figure, for the comment numbers.
  const MARGIN = 16;
  const ZOOM_STEP = 1.25;
  const isSvg = $derived(mimeType === 'image/svg+xml');

  let host: HTMLElement | undefined = $state();
  let dialog: HTMLElement | undefined = $state();
  // The click that opened a report's figure left the keyboard in the report's frame,
  // where this window hears no keys (Esc, the shortcuts): take it to the overlay.
  $effect(() => {
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  });
  let active = $state<number | null>(null);
  let hovered = $state<string | null>(null);
  let dragBox = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);
  // The ids the figure has now: elements a new version lost are marked as gone.
  let present = $state<Set<string> | null>(null);
  let layout = $state(0);
  let zoomPercent = $state(100);
  let panning = $state(false);
  // What one finger or the mouse does on the figure: move it around, or select a part to comment on.
  // It opens in move mode, to look the figure over first.
  type Mode = 'move' | 'select';
  let mode = $state<Mode>('move');
  function setMode(next: Mode): void {
    mode = next;
    hovered = null;
  }
  const boxes: Record<number, HTMLTextAreaElement | undefined> = $state({});
  // The comments float over the figure, which keeps the whole space: open
  // from their button, and by themselves when a part is marked.
  let commentsOpen = $state(false);
  let nextKey = Math.max(0, ...notes.map((note) => note.key)) + 1;

  // The view: the figure's scale (1 is its own size) and where its corner is.
  // Kept across new versions of the file; the controls reach it through `view`.
  let scale = 1;
  let offset = { x: 0, y: 0 };
  let fitted = true;
  let view: { zoom: (factor: number, at?: { x: number; y: number }) => void; fit: () => void; actual: () => void } | undefined;

  const gone = (element: FeedbackElement) => isSvg && present !== null && !present.has(element.id);
  const written = $derived(notes.filter((note) => note.comment.trim()));
  const canSend = $derived(sendable && (written.length > 0 || general.trim().length > 0));
  /** Comments drafted, the general one too: the button counts them. */
  const drafted = $derived(notes.length + (general.trim() ? 1 : 0));
  const howToMark = $derived(isSvg ? 'Click an element or drag over an area' : 'Drag over an area');

  async function focusNote(key: number): Promise<void> {
    active = key;
    commentsOpen = true;
    await tick();
    boxes[key]?.focus();
  }

  function addNote(note: Omit<Note, 'key' | 'comment'>): void {
    const key = nextKey++;
    notes.push({ key, comment: '', ...note });
    void focusNote(key);
  }

  function removeNote(key: number): void {
    const index = notes.findIndex((note) => note.key === key);
    if (index >= 0) notes.splice(index, 1);
    if (active === key) active = null;
  }

  function pick(element: SVGElement | null, add: boolean): void {
    if (!element) {
      active = null;
      return;
    }
    const item = describeElement(element);
    const current = notes.find((note) => note.key === active);
    if (add && current) {
      const elements = current.elements ?? [];
      const chosen = elements.some((other) => other.id === item.id);
      current.elements = chosen ? elements.filter((other) => other.id !== item.id) : [...elements, item];
      if (!current.elements.length && !current.region) removeNote(current.key);
      return;
    }
    const owner = notes.find((note) => note.elements?.some((other) => other.id === item.id));
    if (owner) void focusNote(owner.key);
    else addNote({ elements: [item] });
  }

  /** The dragged area as a share of the figure, and in the file's own units. */
  function region(figure: Element, area: { left: number; top: number; right: number; bottom: number }): FeedbackRegion | null {
    const box = figure.getBoundingClientRect();
    const left = Math.max(area.left, box.left);
    const right = Math.min(area.right, box.right);
    const top = Math.max(area.top, box.top);
    const bottom = Math.min(area.bottom, box.bottom);
    if (right - left < DRAG_PIXELS || bottom - top < DRAG_PIXELS || !box.width || !box.height) return null;
    const share = {
      x: (left - box.left) / box.width,
      y: (top - box.top) / box.height,
      width: (right - left) / box.width,
      height: (bottom - top) / box.height
    };
    if (figure instanceof SVGSVGElement) {
      const toFigure = figure.getScreenCTM()?.inverse();
      if (!toFigure) return share;
      const start = new DOMPoint(left, top).matrixTransform(toFigure);
      const end = new DOMPoint(right, bottom).matrixTransform(toFigure);
      return { ...share, units: { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y, unit: 'svg' } };
    }
    if (figure instanceof HTMLImageElement && figure.naturalWidth) {
      const [width, height] = [figure.naturalWidth, figure.naturalHeight];
      return {
        ...share,
        units: { x: share.x * width, y: share.y * height, width: share.width * width, height: share.height * height, unit: 'px' }
      };
    }
    return share;
  }

  const CSS_UNITS: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

  /** The figure's own size in CSS pixels: an SVG's width and height, else its viewBox; an image's pixels. */
  function naturalSize(figure: SVGSVGElement | HTMLImageElement): { width: number; height: number } {
    if (figure instanceof HTMLImageElement) return { width: figure.naturalWidth || 300, height: figure.naturalHeight || 150 };
    const length = (value: string | null) => {
      const match = value?.trim().match(/^([\d.]+)\s*(px|pt|pc|mm|cm|in)?$/);
      return match ? Number(match[1]) * CSS_UNITS[match[2] ?? 'px']! : null;
    };
    const box = figure.viewBox.baseVal;
    const [width, height] = [length(figure.getAttribute('width')), length(figure.getAttribute('height'))];
    if (box && box.width && box.height) {
      if (width) return { width, height: (width * box.height) / box.width };
      if (height) return { width: (height * box.width) / box.height, height };
      return { width: box.width, height: box.height };
    }
    return { width: width ?? 300, height: height ?? 150 };
  }

  // The figure, in a shadow root so an SVG's styles stay its own.
  $effect(() => {
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const content = isSvg ? sanitizeSvg(decodeText(data)) : `<img src="data:${mimeType};base64,${data}" alt="" draggable="false">`;
    root.innerHTML = `<style>${FIGURE_STYLE}</style><div class="view"><div class="stage">${content}<div class="marks"></div></div></div>`;
    const viewport = root.querySelector<HTMLElement>('.view')!;
    const stage = root.querySelector<HTMLElement>('.stage')!;
    const figure = root.querySelector<SVGSVGElement | HTMLImageElement>('.stage > svg, .stage > img');
    if (!figure) {
      present = new Set();
      return;
    }
    present = new Set([...root.querySelectorAll('[id]')].map((element) => element.id));
    const svg = figure instanceof SVGSVGElement ? figure : null;
    let natural = { width: 300, height: 150 };

    const apply = () => {
      figure.style.width = `${natural.width * scale}px`;
      figure.style.height = `${natural.height * scale}px`;
      // Pixels show as pixels when zoomed far into an image.
      figure.style.imageRendering = scale >= 3 ? 'pixelated' : 'auto';
      stage.style.left = `${offset.x}px`;
      stage.style.top = `${offset.y}px`;
      zoomPercent = Math.round(scale * 100);
      // Also called while the figure is drawn: redrawing the marks must not make this effect depend on them.
      untrack(() => layout++);
    };
    const fitScale = () => {
      const width = viewport.clientWidth - 2 * MARGIN;
      const height = viewport.clientHeight - 2 * MARGIN;
      return Math.max(0.01, Math.min(width / natural.width, height / natural.height));
    };
    const center = () => {
      offset = {
        x: (viewport.clientWidth - natural.width * scale) / 2,
        y: (viewport.clientHeight - natural.height * scale) / 2
      };
    };
    view = {
      fit: () => {
        fitted = true;
        scale = fitScale();
        center();
        apply();
      },
      actual: () => {
        fitted = false;
        scale = 1;
        center();
        apply();
      },
      zoom: (factor, at) => {
        const point = at ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
        const limit = fitScale();
        const next = Math.min(Math.max(scale * factor, Math.min(limit / 4, 0.1)), Math.max(limit * 20, 8));
        // The point under the cursor stays where it is.
        offset = { x: point.x - ((point.x - offset.x) * next) / scale, y: point.y - ((point.y - offset.y) * next) / scale };
        scale = next;
        fitted = false;
        apply();
      }
    };
    const ready = () => {
      natural = naturalSize(figure);
      if (fitted) view!.fit();
      else apply();
    };
    if (figure instanceof HTMLImageElement && !figure.complete) figure.addEventListener('load', ready, { once: true });
    else ready();

    // One finger, or the mouse, moves the figure in move mode; in select mode it
    // drags out an area, or clicks an SVG element. Two fingers pinch and move in
    // either mode. The middle button, or Space and drag, always moves.
    type Point = { x: number; y: number };
    const pointers = new Map<number, Point>();
    let gesture: { kind: 'mark'; start: Point } | { kind: 'pan'; from: Point } | { kind: 'pinch'; mid: Point; distance: number } | null = null;
    let spaceHeld = false;
    const local = (point: Point): Point => {
      const at = viewport.getBoundingClientRect();
      return { x: point.x - at.left, y: point.y - at.top };
    };
    const startPan = (point: Point) => {
      gesture = { kind: 'pan', from: { x: point.x - offset.x, y: point.y - offset.y } };
      panning = true;
    };
    const startPinch = () => {
      const [a, b] = [...pointers.values()] as [Point, Point];
      gesture = { kind: 'pinch', mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      dragBox = null;
      hovered = null;
      panning = true;
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      viewport.setPointerCapture(event.pointerId);
      if (pointers.size >= 2) startPinch();
      else if (event.button === 1 || spaceHeld || mode === 'move') startPan(point);
      else gesture = { kind: 'mark', start: point };
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) {
        hovered = svg && mode === 'select' && !spaceHeld ? (selectableElement(event.target, svg)?.id ?? null) : null;
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (!gesture) return;
      if (gesture.kind === 'pinch') {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()] as [Point, Point];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        offset = { x: offset.x + mid.x - gesture.mid.x, y: offset.y + mid.y - gesture.mid.y };
        view!.zoom(distance / gesture.distance, local(mid));
        gesture = { kind: 'pinch', mid, distance };
      } else if (gesture.kind === 'pan') {
        offset = { x: point.x - gesture.from.x, y: point.y - gesture.from.y };
        fitted = false;
        apply();
      } else if (dragBox || Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > DRAG_PIXELS) {
        hovered = null;
        const { start } = gesture;
        dragBox = {
          left: Math.min(start.x, point.x),
          top: Math.min(start.y, point.y),
          right: Math.max(start.x, point.x),
          bottom: Math.max(start.y, point.y)
        };
      }
    };
    const up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      const ended = gesture;
      if (ended?.kind === 'mark' && event.type === 'pointerup') {
        const area = dragBox;
        dragBox = null;
        if (area) {
          const marked = region(figure, area);
          if (marked) addNote({ region: marked });
        } else if (svg) {
          // The pointer is captured by the view: find what is under it.
          pick(selectableElement(root.elementFromPoint(event.clientX, event.clientY), svg), event.shiftKey || event.metaKey || event.ctrlKey);
        }
      }
      dragBox = null;
      // A finger left after a pinch keeps moving the figure; it does not start an area.
      const [rest] = pointers.values();
      if (rest && pointers.size >= 2) startPinch();
      else if (rest && ended?.kind !== 'mark') startPan(rest);
      else {
        gesture = null;
        panning = false;
      }
    };
    const leave = () => (hovered = null);

    // Ctrl or Cmd and the wheel, or a pinch, zooms at the cursor; the wheel alone moves.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const at = viewport.getBoundingClientRect();
        view!.zoom(Math.exp(-event.deltaY * unit * 0.0025), { x: event.clientX - at.left, y: event.clientY - at.top });
      } else {
        offset = { x: offset.x - event.deltaX * unit, y: offset.y - event.deltaY * unit };
        fitted = false;
        apply();
      }
    };
    const typing = (event: KeyboardEvent) => event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
    const keyDown = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if (event.key === ' ') {
        spaceHeld = true;
        viewport.classList.add('grab');
        event.preventDefault();
      } else if (event.key === '+' || event.key === '=') view!.zoom(ZOOM_STEP);
      else if (event.key === '-') view!.zoom(1 / ZOOM_STEP);
      else if (event.key === '0') view!.fit();
      else if (event.key === '1') view!.actual();
      else if (event.key === 'h') setMode('move');
      else if (event.key === 'v') setMode('select');
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      spaceHeld = false;
      viewport.classList.remove('grab');
    };

    viewport.addEventListener('pointerdown', down);
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
    viewport.addEventListener('pointercancel', up);
    viewport.addEventListener('pointerleave', leave);
    viewport.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    const resized = new ResizeObserver(() => (fitted ? view?.fit() : apply()));
    resized.observe(viewport);
    return () => {
      resized.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      view = undefined;
    };
  });

  // The cursor follows the mode; the figure is redrawn when the file changes.
  $effect(() => {
    void layout;
    const viewport = host?.shadowRoot?.querySelector<HTMLElement>('.view');
    if (viewport) viewport.dataset.mode = mode;
  });

  // Outlines and numbers over what each comment is about, the hovered element and the area being dragged.
  $effect(() => {
    void layout;
    void present;
    const root = host?.shadowRoot;
    const marks = root?.querySelector<HTMLElement>('.marks');
    const stage = root?.querySelector<HTMLElement>('.stage');
    const figure = root?.querySelector('.stage > svg, .stage > img');
    if (!root || !marks || !stage || !figure) return;
    const origin = stage.getBoundingClientRect();
    const area = figure.getBoundingClientRect();
    const draw = (box: { left: number; top: number; width: number; height: number }, kind: string, badge = '') =>
      `<div class="mark ${kind}" style="left:${box.left - origin.left - 3}px;top:${box.top - origin.top - 3}px;width:${box.width + 6}px;height:${box.height + 6}px">${badge}</div>`;
    const html: string[] = [];
    const taken = new Set<string>();
    notes.forEach((note, index) => {
      const kind = note.key === active ? 'chosen active' : 'chosen';
      let badge = `<span>${index + 1}</span>`;
      for (const element of note.elements ?? []) {
        taken.add(element.id);
        const target = root.getElementById(element.id);
        if (!target) continue;
        html.push(draw(target.getBoundingClientRect(), kind, badge));
        badge = '';
      }
      if (note.region) {
        const { x, y, width, height } = note.region;
        html.push(
          draw({ left: area.left + x * area.width, top: area.top + y * area.height, width: width * area.width, height: height * area.height }, kind, badge)
        );
      }
    });
    const hover = hovered && !taken.has(hovered) ? root.getElementById(hovered) : null;
    if (hover) html.push(draw(hover.getBoundingClientRect(), 'hover'));
    if (dragBox) html.push(draw({ left: dragBox.left, top: dragBox.top, width: dragBox.right - dragBox.left, height: dragBox.bottom - dragBox.top }, 'hover'));
    marks.innerHTML = html.join('');
  });

  const FIGURE_STYLE = `:host{all:initial;display:block;position:absolute;inset:0}
    .view{position:absolute;inset:0;overflow:hidden;cursor:crosshair;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
    .view[data-mode=move],.view[data-mode=move] *,.view.grab,.view.grab *{cursor:grab!important}
    .view[data-mode=move]:active,.view[data-mode=move]:active *{cursor:grabbing!important}
    .stage{position:absolute;left:0;top:0}
    svg,img{display:block;max-width:none;background:#fff;border-radius:4px;box-shadow:0 1px 4px rgb(0 0 0 / 0.15)}
    svg [id]{cursor:pointer}
    .marks{position:absolute;inset:0;pointer-events:none}
    .mark{position:absolute;box-sizing:border-box;border-radius:5px}
    .mark.chosen{border:2px solid rgb(79 70 229 / 0.7);background:rgb(79 70 229 / 0.06)}
    .mark.active{border-color:#4f46e5;background:rgb(79 70 229 / 0.12)}
    .mark.hover{border:1.5px dashed #4f46e5}
    .mark span{position:absolute;left:-10px;top:-10px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#4f46e5;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center}`;

  function send(): void {
    if (!canSend) return;
    const annotations: FeedbackAnnotation[] = [];
    for (const note of written) {
      const elements = (note.elements ?? []).filter((element) => !gone(element)).map((element) => ({ ...element }));
      if (!elements.length && !note.region) continue;
      annotations.push({
        comment: note.comment.trim(),
        ...(elements.length ? { elements } : {}),
        ...(note.region ? { region: $state.snapshot(note.region) } : {})
      });
    }
    onsend(general.trim(), annotations);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // The comments first, then the figure.
      if (commentsOpen) commentsOpen = false;
      else onclose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  }}
/>

<div
  bind:this={dialog}
  class="fixed inset-0 z-50 flex flex-col bg-paper outline-none"
  role="dialog"
  aria-modal="true"
  aria-label="Comment on {title}"
  tabindex="-1"
>
  <header class="flex items-center gap-3 border-b-[1.5px] border-soft-line px-4 py-2.5 max-[640px]:flex-wrap max-[640px]:gap-2 max-[640px]:px-3">
    <div class="min-w-0 flex-1 max-[640px]:basis-[calc(100%-3rem)]">
      <h2 class="m-0 truncate font-display text-[1.1rem] leading-tight font-medium">{title}</h2>
      {#if subtitle}
        <p class="m-0 truncate text-[0.8em] text-muted" title={subtitle}>{subtitle}</p>
      {/if}
    </div>
    <div
      class="flex shrink-0 rounded-full border-[1.5px] border-soft-line bg-code p-0.5 text-[0.8em] font-semibold"
      role="radiogroup"
      aria-label="What dragging does"
    >
      {#each [{ value: 'move', icon: 'move', label: 'Move', title: 'Drag to move, pinch to zoom (H)' }, { value: 'select', icon: 'inspect', label: 'Select', title: 'Drag over an area, or click an element, to comment on it (V)' }] as const as option (option.value)}
        <button
          role="radio"
          aria-checked={mode === option.value}
          class="flex items-center gap-1 rounded-full border-none px-2 py-0.5 pointer-coarse:px-3 pointer-coarse:py-1.5 {mode === option.value
            ? 'bg-card text-ink shadow-sm'
            : 'bg-transparent text-muted hover:text-ink'}"
          title={option.title}
          onclick={() => setMode(option.value)}
        >
          <span class="codicon codicon-{option.icon} text-[12px]!"></span>
          {option.label}
        </button>
      {/each}
    </div>
    <div class="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom">
      <button class="chip" title="Zoom out (-)" aria-label="Zoom out" onclick={() => view?.zoom(1 / ZOOM_STEP)}>
        <span class="codicon codicon-zoom-out"></span>
      </button>
      <button class="chip min-w-[4.2em] justify-center tabular-nums" title="Show at its own size (1)" onclick={() => view?.actual()}>
        {zoomPercent}%
      </button>
      <button class="chip" title="Zoom in (+)" aria-label="Zoom in" onclick={() => view?.zoom(ZOOM_STEP)}>
        <span class="codicon codicon-zoom-in"></span>
      </button>
      <button class="chip" title="Fit to the space (0)" onclick={() => view?.fit()}>
        <span class="codicon codicon-screen-normal"></span> Fit
      </button>
    </div>
    {#if ondownload}
      <button class="chip shrink-0" title="Save a copy on this machine" aria-label="Download" onclick={ondownload}>
        <span class="codicon codicon-cloud-download"></span>
      </button>
    {/if}
    <button
      class="pill pill-primary pill-small shrink-0"
      disabled={!canSend}
      title={sendable ? 'Send the comments to the agent (Ctrl+Enter)' : sendHint}
      onclick={send}
    >
      Send {written.length ? `${written.length} comment${written.length === 1 ? '' : 's'}` : 'to the agent'}
      <span class="codicon codicon-arrow-up"></span>
    </button>
    <button class="chip shrink-0" title="Close; your comments are kept (Esc)" aria-label="Close" onclick={onclose}>
      <span class="codicon codicon-close"></span>
    </button>
  </header>

  <div class="relative min-h-0 flex-1 bg-sunken">
    <div bind:this={host}></div>
    <!-- What the pointer does now, and how to comment: the one place it is said. -->
    <p
      class="pointer-events-none absolute bottom-3 left-3 m-0 max-w-[calc(100%-10rem)] rounded-2xl bg-card/90 px-3 py-1 text-[0.75em] text-muted"
    >
      {#if mode === 'move'}
        Drag to move · pinch or Ctrl+scroll to zoom · <strong class="text-ink">Select</strong> (V) to comment on a part
      {:else}
        <strong class="text-ink">{howToMark}</strong> to comment on it · two fingers or Space+drag to move
      {/if}
    </p>

    {#if commentsOpen}
      <section
        class="card absolute right-3 bottom-16 z-10 flex max-h-[calc(100%-5.5rem)] w-96 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden"
        aria-label="Comments"
      >
        <div class="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
          <span class="eyebrow flex-1 text-indigo">Comments</span>
          <button class="chip px-1.5!" title="Hide the comments; they are kept (Esc)" aria-label="Hide the comments" onclick={() => (commentsOpen = false)}>
            <span class="codicon codicon-chevron-down"></span>
          </button>
        </div>
        <div class="thin-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
          {#each notes as note, index (note.key)}
            <div class="flex flex-col gap-1 rounded-xl border-[1.5px] bg-paper px-2.5 py-2 {note.key === active ? 'border-indigo' : 'border-soft-line'}">
              <div class="flex items-center gap-2 text-[0.8em]">
                <span class="grid size-[18px] shrink-0 place-items-center rounded-full bg-indigo text-[11px] font-bold text-on-accent">{index + 1}</span>
                <span class="min-w-0 flex-1 truncate font-mono" title={annotationTarget(note)}>
                  {#each note.elements ?? [] as element, position (element.id)}
                    {#if position}, {/if}<span class={gone(element) ? 'text-muted line-through' : ''} title={gone(element) ? 'The figure no longer has this element' : undefined}
                      >{elementName(element)}</span
                    >
                  {/each}
                  {#if note.region}{note.elements?.length ? ' · ' : ''}area{/if}
                </span>
                <button
                  type="button"
                  class="codicon codicon-trash cursor-pointer border-none bg-transparent p-0 text-muted hover:text-ink"
                  aria-label="Delete comment {index + 1}"
                  onclick={() => removeNote(note.key)}
                ></button>
              </div>
              <textarea
                rows="2"
                class="min-h-[2.8em] resize-y rounded-md border-none bg-transparent p-0.5 outline-none placeholder:text-muted"
                placeholder="What should change here?"
                bind:this={boxes[note.key]}
                bind:value={note.comment}
                onfocus={() => (active = note.key)}
              ></textarea>
            </div>
          {:else}
            <div class="flex items-center gap-2 rounded-xl bg-code px-2.5 py-2 text-[0.85em] text-muted">
              <span class="min-w-0 flex-1">
                {mode === 'select' ? `${howToMark} of the figure to comment on it.` : 'To comment on a part, select it in the figure.'}
              </span>
              {#if mode === 'move'}
                <button class="chip shrink-0" title="Select a part to comment on (V)" onclick={() => setMode('select')}>
                  <span class="codicon codicon-inspect text-[12px]!"></span> Select a part
                </button>
              {/if}
            </div>
          {/each}
          <label class="flex flex-col gap-1 pt-1 text-[0.8em] text-muted">
            General comment
            <textarea
              rows="3"
              class="resize-y rounded-xl border-[1.5px] border-soft-line bg-paper px-2.5 py-2 text-[1.25em] text-ink outline-none placeholder:text-muted focus:border-indigo"
              placeholder="Anything about the whole figure"
              bind:value={general}
            ></textarea>
          </label>
          {#if !sendable}
            <p class="m-0 text-[0.8em] text-muted">{sendHint}</p>
          {/if}
        </div>
      </section>
    {/if}

    <button
      class="pill pill-small absolute right-3 bottom-3 z-10 shadow-md {commentsOpen ? 'pill-primary' : 'bg-card!'}"
      aria-expanded={commentsOpen}
      aria-label={drafted ? `Comments (${drafted})` : 'Comments'}
      title={commentsOpen ? 'Hide the comments (Esc)' : 'Show the comments'}
      onclick={() => (commentsOpen = !commentsOpen)}
    >
      <span class="codicon codicon-comment"></span>
      Comments
      {#if drafted}
        <span class="grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] font-bold {commentsOpen ? 'bg-card text-indigo' : 'bg-indigo text-on-accent'}">{drafted}</span>
      {/if}
    </button>
  </div>
</div>
