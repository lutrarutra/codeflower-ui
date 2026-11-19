<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  import { copyText } from './clipboard.ts';
  import { highlightElement } from './editor/highlight.ts';
  import { PATH_IN_TEXT, isLocalHref, looksLikeFile } from './files.ts';

  // Agent output is untrusted: render markdown, then sanitize the HTML.
  // With `openFile`, file paths and local links open in a preview; with
  // `asset`, local images (e.g. a report's figures) load through the host.
  let {
    text,
    openFile,
    asset
  }: { text: string; openFile?: (path: string) => void; asset?: (path: string) => string | null | undefined } =
    $props();
  const html = $derived(DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true, async: false })));
  let root: HTMLElement | undefined = $state();
  let frame: HTMLElement | undefined = $state();
  // The code block under the pointer, with its copy button over its top
  // right corner. One button for all blocks, outside the rendered markdown,
  // so it stays put when a wide block scrolls sideways.
  let block: HTMLElement | undefined = $state();
  let corner = $state({ top: 0, right: 0 });
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function hover(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('.code-copy')) return;
    const pre = target.closest('pre');
    const next = pre && root?.contains(pre) ? pre : undefined;
    if (next === block) return;
    block = next;
    copied = false;
    if (!next || !frame) return;
    const outer = frame.getBoundingClientRect();
    const box = next.getBoundingClientRect();
    corner = { top: box.top - outer.top, right: outer.right - box.right };
  }

  async function copyBlock() {
    if (!block) return;
    await copyText(block.textContent ?? '');
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1500);
  }

  // Inline code copies on a click, unless it opens a file or sits in a link.
  async function copyInline(code: HTMLElement) {
    await copyText(code.textContent ?? '');
    code.dataset.copied = '';
    setTimeout(() => delete code.dataset.copied, 1200);
  }

  $effect(() => {
    void html;
    if (!root || !openFile) return;
    for (const code of root.querySelectorAll('code')) {
      const path = code.textContent?.trim() ?? '';
      if (!code.closest('pre') && looksLikeFile(path)) code.dataset.file = path;
    }
    // Paths in plain text, e.g. a list of the files the agent wrote.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('code, pre, a, [data-file]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const node of texts) {
      const value = node.nodeValue ?? '';
      const matches = [...value.matchAll(PATH_IN_TEXT)];
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let last = 0;
      for (const match of matches) {
        fragment.append(value.slice(last, match.index));
        const span = document.createElement('span');
        span.dataset.file = match[0];
        span.textContent = match[0];
        fragment.append(span);
        last = match.index + match[0].length;
      }
      fragment.append(value.slice(last));
      node.replaceWith(fragment);
    }
    for (const link of root.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') ?? '';
      if (isLocalHref(href)) (link as HTMLElement).dataset.file = decodeURI(href);
    }
  });

  // Web links open in a new tab, so the chat stays where it is.
  $effect(() => {
    void html;
    if (!root) return;
    for (const link of root.querySelectorAll('a[href]')) {
      if (!/^https?:\/\//i.test(link.getAttribute('href') ?? '')) continue;
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // Fenced code in the language it names (```python); others stay plain.
  $effect(() => {
    void html;
    if (!root) return;
    for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
      const name = /\blanguage-(\S+)/.exec(code.className)?.[1];
      if (name) void highlightElement(code, name);
    }
  });

  // New markdown replaces the blocks, so the hovered one is gone.
  $effect(() => {
    void html;
    block = undefined;
  });

  // After the file links above, so a path in code still opens the file.
  $effect(() => {
    void html;
    if (!root) return;
    for (const code of root.querySelectorAll<HTMLElement>('code')) {
      if (code.closest('pre, a') || code.dataset.file !== undefined) continue;
      code.dataset.copy = '';
      code.title = 'Copy';
    }
  });

  $effect(() => {
    void html;
    if (!root || !asset) return;
    for (const image of root.querySelectorAll('img')) {
      const source = image.dataset.src ?? image.getAttribute('src') ?? '';
      if (!isLocalHref(source)) continue;
      image.dataset.src = source;
      // A figure in a report opens on its own, where it can be zoomed.
      if (openFile) image.dataset.file = source;
      const url = asset(source);
      if (url) image.src = url;
      else image.removeAttribute('src');
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_mouse_events_have_key_events -->
<div bind:this={frame} class="relative" onmouseover={hover} onmouseleave={() => (block = undefined)}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    bind:this={root}
    class="prose break-words"
    onclick={(event) => {
      const element = event.target as HTMLElement;
      const target = element.closest<HTMLElement>('[data-file]');
      if (target && openFile) {
        event.preventDefault();
        openFile(target.dataset.file!);
        return;
      }
      const code = element.closest<HTMLElement>('code[data-copy]');
      // A drag that selects part of the code is not a click to copy it.
      if (code && !window.getSelection()?.toString()) void copyInline(code);
    }}
  >
    {@html html}
  </div>
  {#if block}
    <button
      type="button"
      class="code-copy"
      class:copied
      style:top="{corner.top + 6}px"
      style:right="{corner.right + 6}px"
      title={copied ? 'Copied' : 'Copy'}
      aria-label={copied ? 'Copied' : 'Copy code'}
      onclick={copyBlock}
    >
      <span class="codicon {copied ? 'codicon-check' : 'codicon-copy'}"></span>
    </button>
  {/if}
</div>
