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
    onclose
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
  } = $props();

  // Dragging less than this is a click.
  const DRAG_PIXELS = 5;
  // Room around the fitted figure, for the comment numbers.
  const MARGIN = 16;
  const ZOOM_STEP = 1.25;
  const isSvg = $derived(mimeType === 'image/svg+xml');

  let host: HTMLElement | undefined = $state();
  let active = $state<number | null>(null);
  let hovered = $state<string | null>(null);
  let dragBox = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);
  // The ids the figure has now: elements a new version lost are marked as gone.
  let present = $state<Set<string> | null>(null);
  let layout = $state(0);
  let zoomPercent = $state(100);
  let panning = $state(false);
  const boxes: Record<number, HTMLTextAreaElement | undefined> = $state({});
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

  async function focusNote(key: number): Promise<void> {
    active = key;
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

    // Marking: a drag over the figure marks an area, a click picks an SVG element.
    let start: { x: number; y: number } | null = null;
    let spaceHeld = false;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || spaceHeld) return;
      event.stopPropagation();
      start = { x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!start) {
        hovered = svg && !panning ? (selectableElement(event.target, svg)?.id ?? null) : null;
        return;
      }
      if (dragBox || Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_PIXELS) {
        hovered = null;
        dragBox = {
          left: Math.min(start.x, event.clientX),
          top: Math.min(start.y, event.clientY),
          right: Math.max(start.x, event.clientX),
          bottom: Math.max(start.y, event.clientY)
        };
      }
    };
    const up = (event: PointerEvent) => {
      if (!start) return;
      const area = dragBox;
      start = null;
      dragBox = null;
      if (area) {
        const marked = region(figure, area);
        if (marked) addNote({ region: marked });
      } else if (svg) {
        // The pointer is captured by the stage: find what is under it.
        pick(selectableElement(root.elementFromPoint(event.clientX, event.clientY), svg), event.shiftKey || event.metaKey || event.ctrlKey);
      }
    };
    const leave = () => (hovered = null);

    // Moving around: drag the background, the middle button, or Space and drag.
    let pan: { x: number; y: number } | null = null;
    const panDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      pan = { x: event.clientX - offset.x, y: event.clientY - offset.y };
      panning = true;
      viewport.setPointerCapture(event.pointerId);
    };
    const panMove = (event: PointerEvent) => {
      if (!pan) return;
      offset = { x: event.clientX - pan.x, y: event.clientY - pan.y };
      fitted = false;
      apply();
    };
    const panUp = () => {
      pan = null;
      panning = false;
    };
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
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      spaceHeld = false;
      viewport.classList.remove('grab');
    };

    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointerleave', leave);
    viewport.addEventListener('pointerdown', panDown);
    viewport.addEventListener('pointermove', panMove);
    viewport.addEventListener('pointerup', panUp);
    viewport.addEventListener('pointercancel', panUp);
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
    .view{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;user-select:none}
    .view.grab,.view.grab *{cursor:grab!important}
    .view:active{cursor:grabbing}
    .stage{position:absolute;left:0;top:0}
    svg,img{display:block;max-width:none;background:#fff;border-radius:4px;box-shadow:0 1px 4px rgb(0 0 0 / 0.15);cursor:crosshair}
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
      onclose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  }}
/>

<div class="fixed inset-0 z-50 flex flex-col bg-paper" role="dialog" aria-modal="true" aria-label="Comment on {title}">
  <header class="flex items-center gap-3 border-b-[1.5px] border-soft-line px-4 py-2.5">
    <div class="min-w-0 flex-1">
      <h2 class="m-0 truncate font-display text-[1.1rem] leading-tight font-medium">{title}</h2>
      <p class="m-0 truncate text-[0.8em] text-muted" title={subtitle}>
        {subtitle ? `${subtitle} · ` : ''}{isSvg ? 'Click an element or drag over an area to comment on it' : 'Drag over an area to comment on it'}
      </p>
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

  <div class="flex min-h-0 flex-1 flex-col md:flex-row">
    <div class="relative min-h-[40vh] flex-1 bg-sunken">
      <div bind:this={host}></div>
      <p class="pointer-events-none absolute bottom-2 left-1/2 m-0 -translate-x-1/2 rounded-full bg-card/90 px-3 py-0.5 text-[0.75em] whitespace-nowrap text-muted">
        Scroll to move · Ctrl+scroll or pinch to zoom · drag the background or Space+drag to pan
      </p>
    </div>
    <aside
      class="flex max-h-[45vh] w-full shrink-0 flex-col gap-2 overflow-auto border-t-[1.5px] border-soft-line p-3 md:max-h-none md:w-80 md:border-t-0 md:border-l-[1.5px]"
    >
      {#each notes as note, index (note.key)}
        <div class="card flex flex-col gap-1 px-2.5 py-2 {note.key === active ? 'border-indigo!' : ''}">
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
        <p class="m-0 px-1 py-2 text-[0.9em] text-muted">
          {isSvg ? 'Click an element of the figure, or drag over an area,' : 'Drag over an area of the figure'} to comment on it.
        </p>
      {/each}
      <label class="mt-auto flex flex-col gap-1 pt-2 text-[0.8em] text-muted">
        General comment
        <textarea
          rows="3"
          class="card resize-y px-2.5 py-2 text-[1.25em] text-ink outline-none placeholder:text-muted focus:border-indigo"
          placeholder="Anything about the whole figure"
          bind:value={general}
        ></textarea>
      </label>
      {#if !sendable}
        <p class="m-0 text-[0.8em] text-muted">{sendHint}</p>
      {/if}
    </aside>
  </div>
</div>
