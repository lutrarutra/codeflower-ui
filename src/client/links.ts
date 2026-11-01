// Links an agent asks the user to open (a sign-in page, an MCP server's
// approval) come from the sandbox, which is untrusted: only web pages open.
// Other schemes reach the user's computer instead (vscode://, file:, an
// editor's command: links), so they are refused.

/** The link as a URL when it is a web page (http or https), else undefined. */
export function externalUrl(text: string): URL | undefined {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}
