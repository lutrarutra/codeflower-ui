// The app's HTTP API (app/internal/client): what the page asks and gets.
// Every request carries the page's cookie; writes are JSON, which the app
// requires against cross-site requests.

export interface Step {
  text: string;
  command?: string;
  link?: string;
}

export interface EngineStatus {
  name: string;
  label: string;
  installed: boolean;
  ready: boolean;
  version?: string;
  problem?: string;
  fix?: Step[];
}

export interface AgentChoice {
  id: string;
  label: string;
  description?: string;
  color?: string;
}

export interface Settings {
  agent?: string;
  inputs: string[];
  outputs: string[];
  code: string[];
  skills: string[];
  project?: string;
  engine?: string;
  image?: string;
  imageTag?: string;
  isolateNetwork?: boolean;
}

export interface SystemInfo {
  version: string;
  system: string;
  home: string;
  projects: string;
  engines: EngineStatus[];
  engine: string;
  problem?: string;
  fix?: Step[];
  guide: { system: string; options: { title: string; note?: string; steps: Step[] }[] };
  image?: { name: string; ready: boolean; download?: boolean; error?: string; help?: Step[] };
  /** The sandbox release the app runs when no version is chosen (missing from older apps, which run `latest`). */
  imageTag?: string;
  agents: AgentChoice[];
  settings: Settings;
  configSkills: string[];
  configDirectory?: string;
  isolation: Record<string, string>;
  capabilities: {
    connect: boolean;
    start: boolean;
    startDisabledReason?: string;
    connectOnly: boolean;
    /** The page is served by one sandbox itself (`--server`): it shows only that one, and quitting stops it. */
    single?: boolean;
  };
}

export interface ChatActivity {
  key: string;
  title: string;
  state: 'working' | 'waiting';
  waitingFor?: 'plan' | 'permission' | 'question';
}

export interface UsageLimit {
  id: string;
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
  status?: string;
}

export interface WorkerActivity {
  agent: string;
  agentLabel: string;
  connected: boolean;
  /** How many windows are connected; missing from older sandboxes. */
  clients?: number;
  /** Windows attach side by side instead of taking the sandbox over; missing from older sandboxes. */
  multiClient?: boolean;
  working: number;
  waiting: number;
  chats: ChatActivity[];
  usage?: {
    auth: { kind: string; plan?: string; label?: string };
    limits: UsageLimit[];
    costEstimate: boolean;
    totals: {
      tokens: { inputTokens: number; outputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; totalTokens: number };
      cost?: { amount: number; currency: string };
    };
  };
}

/** started: by this client; added: by its pasted line; local: on this computer, outside this client. */
export type WorkerSource = 'started' | 'added' | 'local';

export interface Worker {
  id: string;
  source: WorkerSource;
  /** worker, run or task, for a local sandbox. */
  kind?: string;
  /** host:port, of an added or local sandbox. */
  address?: string;
  /** The name the user gave it in the list. */
  name?: string;
  engine: string;
  project: string;
  state: string;
  inputs: string[];
  outputs: string[];
  code: string[];
  skills: string[];
  allowlist?: string;
  started: string;
  agent: string;
  label: string;
  status: string;
  url?: string;
  error?: string;
  exitCode: number;
  log: string[];
  activity?: WorkerActivity;
  relays: number;
  quitting?: string;
}

export interface QuitPlan {
  sandboxes: number;
  working: number;
  busy: number;
  elsewhere: number;
  minutes: number;
  quitting?: { started: string; deadline: string; workers: Record<string, string> };
  stopping: boolean;
}

export interface Resources {
  cores: { user: number; system: number; iowait: number }[];
  memory: { total: number; used: number; cached: number; swapTotal: number; swapUsed: number };
  load?: number[];
}

export interface FolderListing {
  path: string;
  parent?: string;
  folders: { name: string; path: string }[];
  files: number;
  places: { name: string; path: string }[];
}

/**
 * The app's API, relative to the page: /api/… locally, and under
 * /m/{connector}/ when the page comes through the tunnel.
 */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path.startsWith('/') ? `.${path}` : path, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `The app answered ${response.status}`);
  return data;
}

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

export function vscodeLink(url: string): string {
  return `vscode://codeflower.codeflower/connect?${new URLSearchParams({ address: url })}`;
}

export const plural = (count: number, noun: string, nouns = `${noun}s`) => `${count} ${count === 1 ? noun : nouns}`;
