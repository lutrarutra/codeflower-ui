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
  /** The computer's name (missing from older apps and from a sandbox's own page). */
  hostname?: string;
  /** The version of the API pages use (see machineIds.ts); missing from older apps. */
  pageApi?: number;
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
  /** browser: the agent handed its browser to the user (codeflower-browser handoff). */
  waitingFor?: 'plan' | 'permission' | 'question' | 'browser';
  /** False for a chat with no turn running: it works on a background command or subagent, or one of those waits. */
  turn?: boolean;
}

export interface UsageLimit {
  id: string;
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
  status?: string;
}

/** One agent of a sandbox, as the app polls it: whether it runs, and its usage. */
export interface AgentActivity {
  id: string;
  running: boolean;
  usage?: AgentUsage;
}

/** An agent's login, its quota, and its tokens and cost since the sandbox started. */
export interface AgentUsage {
  auth: { kind: string; plan?: string; label?: string };
  limits: UsageLimit[];
  costEstimate: boolean;
  totals: {
    tokens: { inputTokens: number; outputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; totalTokens: number };
    cost?: { amount: number; currency: string };
  };
}

export interface WorkerActivity {
  connected: boolean;
  /** How many windows are connected; missing from older sandboxes. */
  clients?: number;
  /** Windows attach side by side instead of taking the sandbox over; missing from older sandboxes. */
  multiClient?: boolean;
  working: number;
  waiting: number;
  chats: ChatActivity[];
  agents?: AgentActivity[];
  /** The versions of the sandbox's parts; missing from older sandboxes. */
  versions?: SandboxVersions;
}

/** What a sandbox's bridge says of its parts' versions; each missing where nothing tells. */
export interface SandboxVersions {
  /** The app that started the sandbox, maybe on another computer (a batch job's). */
  app?: string;
  /** The image's release, and what it was started as (a name:tag, or an Apptainer file). */
  image?: string;
  imageRef?: string;
  /** The page the image serves with --server (codeflower-ui). */
  page?: string;
  storyteller?: string;
  /** The agents' own releases, by agent (claude: Claude Code). */
  agents?: Record<string, string>;
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
  /** The sandbox's label when it has no name: its project, where the app knows it. */
  label: string;
  status: string;
  url?: string;
  error?: string;
  exitCode: number;
  log: string[];
  /** When the sandbox last printed anything; missing from older apps. */
  lastOutput?: string;
  /** The image download's progress, while the sandbox waits for one (Docker only). */
  progress?: PullProgress;
  activity?: WorkerActivity;
  relays: number;
  quitting?: string;
}

/** How far an image download has come: bytes and layers (Docker reports them; Podman and Apptainer only print). */
export interface PullProgress {
  current: number;
  total: number;
  layers: number;
  done: number;
}

/** A build of the published sandbox image an engine has on the computer. */
export interface LocalImage {
  /** What removing it names: name:tag, an id, or an Apptainer file. */
  ref: string;
  /** What it was downloaded as: a release, latest or a commit's build; empty when a newer download took its tag. */
  tag: string;
  version?: string;
  revision?: string;
  size: number;
  created?: string;
  untagged?: boolean;
  /** The build the app runs when no version is chosen. */
  default?: boolean;
  /** A sandbox the app started runs it. */
  inUse?: boolean;
}

/** An image download the page started; it stays listed until dismissed. */
export interface ImagePull {
  id: string;
  engine: string;
  image: string;
  tag: string;
  started: string;
  status: 'pulling' | 'done' | 'failed' | 'cancelled';
  error?: string;
  log: string[];
  lastOutput?: string;
  progress?: PullProgress;
}

/** GET /api/images: an engine's sandbox images and the downloads for it (missing from older apps). */
export interface ImagesInfo {
  engine: string;
  label: string;
  /** Where Apptainer keeps its image files. */
  directory?: string;
  defaultTag: string;
  images: LocalImage[];
  pulls: ImagePull[];
  /** Why the images could not be listed. */
  error?: string;
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

/** GET /api/tunnel: remote access through a code flower tunnel (on the computer itself only). */
export interface TunnelStatus {
  /** The client keeps a tunnel connected once signed in. */
  available: boolean;
  url: string;
  signedIn: boolean;
  off: boolean;
  region?: string;
  /** config.yaml's answer; null until the first sign-in. */
  euOnly: boolean | null;
  hardened: boolean;
  manage: boolean;
  fingerprint?: string;
  devices: { key: string; label: string; fingerprint: string; pairedAt: string; workers?: string[] }[];
  /** Where paired browsers open code flower, once connected. */
  pageUrl?: string;
  /** A sign-in waiting for its code to be approved. */
  login?: { verificationUrl: string; userCode: string; name: string; fingerprint: string; expiresAt: string };
  loginError?: string;
}

export interface TunnelPairing {
  link: string;
  fingerprint: string;
  expiresAt: string;
}

export interface FolderListing {
  path: string;
  parent?: string;
  folders: { name: string; path: string }[];
  files: number;
  places: { name: string; path: string }[];
}

export { copyText } from '../../chat/lib/clipboard.ts';

export function vscodeLink(url: string): string {
  return `vscode://codeflower.codeflower/connect?${new URLSearchParams({ address: url })}`;
}

export const plural = (count: number, noun: string, nouns = `${noun}s`) => `${count} ${count === 1 ? noun : nouns}`;
