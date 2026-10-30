import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { AgentName } from '../protocol/messages.ts';

// Must match sessionKey() in codeflower-sandbox: dsh-plugins/acp-ws/src/sessions.js.
// Synchronous SHA-256 that runs in a browser as in Node.
export function sessionKey(harness: AgentName, nativeSessionId: string): string {
  const readable = /^[A-Za-z0-9._-]{1,96}$/.test(nativeSessionId);
  const suffix = readable ? nativeSessionId : bytesToHex(sha256(utf8ToBytes(nativeSessionId))).slice(0, 32);
  return `${harness}-${suffix}`;
}
