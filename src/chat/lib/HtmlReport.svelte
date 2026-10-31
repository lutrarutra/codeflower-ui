<script module lang="ts">
  import type { FeedbackFigure } from '../../protocol/messages.ts';

  /** A figure of the report the user clicked, to comment on its parts. */
  export interface ReportFigure {
    figure: FeedbackFigure;
    mimeType: string;
    /** The image, base64. */
    data: string;
  }
</script>

<script lang="ts">
  import { encodeText } from './files.ts';

  // An HTML report, sanitized (no scripts or handlers) and rendered in a shadow
  // root, so its styles neither leak out nor pick up the chat's. Its figures
  // open for comments when clicked, if the host takes them.
  let { html, onfigure }: { html: string; onfigure?: (figure: ReportFigure) => void } = $props();
  let host: HTMLElement | undefined = $state();
  // storyteller reports mark their parts with a content hash: parts that changed
  // since the last version flash (their stylesheet has the animation).
  let hashes = new Map<string, string>();
  // Smaller images are icons or decorations, not figures.
  const MIN_FIGURE_PIXELS = 48;
  const FIGURE_TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;

  $effect(() => {
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const document = new DOMParser().parseFromString(html, 'text/html');
    // The report's page-level rules apply to its container here, and its width
    // queries to the container's width: the window can be much wider (a tab
    // beside the chat in the app).
    const styles = [...document.querySelectorAll('style')]
      .map(
        (style) =>
          `<style>${(style.textContent ?? '')
            .replace(/(^|[\s,}])(html|body)(?=[\s,{.:#[])/g, '$1.report')
            .replace(/@media\s*(\(\s*(?:min|max)-width\s*:[^)]*\)(?:\s*and\s*\(\s*(?:min|max)-width\s*:[^)]*\))*)\s*\{/g, '@container $1 {')}</style>`
      )
      .join('');
    // Reports are written for paper: dark text on white, whatever the editor theme.
    // all:initial would make the host visible in a hidden tab: it keeps the tab's visibility.
    const commentable = onfigure ? '.report img.cf-commentable,.report svg.cf-commentable{cursor:zoom-in}' : '';
    root.innerHTML = `<style>:host{all:initial;display:block;visibility:inherit;color:#1d1d1f;font-family:system-ui,sans-serif;line-height:1.5}
      .report{container-type:inline-size;padding:24px 28px;overflow-wrap:anywhere} img,svg,table{max-width:100%;height:auto}${commentable}</style>${styles}<div class="report">${document.body.innerHTML}</div>`;
    const parts = [...root.querySelectorAll<HTMLElement>('[data-cf-part]')];
    for (const part of parts) {
      const before = hashes.get(part.dataset.cfPart ?? '');
      if (hashes.size && before !== part.dataset.cfHash) part.classList.add('cf-changed');
    }
    hashes = new Map(parts.map((part) => [part.dataset.cfPart ?? '', part.dataset.cfHash ?? '']));
    if (!onfigure) return;
    for (const figure of figures(root)) {
      figure.classList.add('cf-commentable');
      if (!figure.querySelector(':scope > title')) figure.setAttribute('title', 'Click to comment on parts of this figure');
    }
  });

  /**
   * The report's figures, in order: images and outermost SVGs that are not
   * links or buttons. In a report with <figure>s (storyteller's) only theirs,
   * so the numbers match the report's; else none from its header or footer.
   */
  function figures(root: ShadowRoot): (HTMLImageElement | SVGSVGElement)[] {
    const images = [...root.querySelectorAll<HTMLImageElement | SVGSVGElement>('.report img, .report svg')].filter(
      (element) =>
        !element.parentElement?.closest('svg, a, button') &&
        (element instanceof SVGSVGElement || /^data:/.test(element.getAttribute('src') ?? ''))
    );
    const inFigures = images.filter((element) => element.closest('figure'));
    return inFigures.length ? inFigures : images.filter((element) => !element.closest('header, footer, nav'));
  }

  function imageOf(element: HTMLImageElement | SVGSVGElement): { mimeType: string; data: string } | null {
    if (element instanceof SVGSVGElement) {
      const copy = element.cloneNode(true) as SVGSVGElement;
      copy.classList.remove('cf-commentable');
      copy.removeAttribute('title');
      return { mimeType: 'image/svg+xml', data: encodeText(new XMLSerializer().serializeToString(copy)) };
    }
    const match = (element.getAttribute('src') ?? '').match(/^data:([^;,]+)((?:;[^;,]*)*?)(;base64)?,(.*)$/s);
    if (!match || !FIGURE_TYPES.test(match[1]!)) return null;
    return { mimeType: match[1]!, data: match[3] ? match[4]!.replace(/\s/g, '') : encodeText(decodeURIComponent(match[4]!)) };
  }

  $effect(() => {
    const root = host?.shadowRoot;
    if (!root || !onfigure) return;
    const open = (event: Event) => {
      const target = event.composedPath()[0];
      if (!(target instanceof Element)) return;
      let element = target.closest<HTMLImageElement | SVGSVGElement>('img, svg');
      while (element instanceof SVGSVGElement && element.parentElement?.closest('svg')) element = element.parentElement.closest('svg');
      const all = figures(root);
      const index = element ? all.indexOf(element) : -1;
      if (!element || index < 0) return;
      const box = element.getBoundingClientRect();
      if (box.width < MIN_FIGURE_PIXELS || box.height < MIN_FIGURE_PIXELS) return;
      const image = imageOf(element);
      if (!image) return;
      event.preventDefault();
      const caption = (element.closest('figure')?.querySelector('figcaption')?.textContent ?? element.getAttribute('alt') ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const part = element.closest('[data-cf-part]')?.getAttribute('data-cf-part') ?? '';
      const anchor = element.parentElement?.closest('[id]')?.id ?? '';
      onfigure({
        ...image,
        figure: { index: index + 1, ...(caption ? { caption } : {}), ...(part ? { part } : {}), ...(anchor ? { anchor } : {}) }
      });
    };
    root.addEventListener('click', open);
    return () => root.removeEventListener('click', open);
  });
</script>

<div bind:this={host} class="overflow-auto rounded-lg border-[1.5px] border-soft-line bg-white"></div>
