// The clipboard API needs a secure context and focus; the hidden textarea
// covers the pages where it is missing or refused.
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.style.cssText = 'position:fixed;opacity:0';
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}
