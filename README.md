# codeflower-ui

The chat of [code flower](https://github.com/lutrarutra/codeflower-workspace) and the ACP client behind it, shared by the
[VS Code extension](https://github.com/lutrarutra/codeflower-vsc-extension) and the
[app](https://github.com/lutrarutra/codeflower-app). It ships as TypeScript and Svelte source: each host's bundler
(esbuild, Vite) compiles it, so it has no build step of its own.

```
src/protocol/  messages between a chat and its host, usage types
src/client/    the client, in layers; each uses only the ones above it
  transport.ts         text frames over anything: a browser WebSocket here, `ws` in the extension, memory in tests
  rpc.ts               JSON-RPC 2.0, passing messages through as sent (no schema strips what it does not know)
  acp.ts               standard ACP: sessions, prompts, settings, permissions, questions, sign-in
  codeflower.ts        the bridge's `_codeflower/*` methods: status, recorded sessions, files, shell, terminals, usage
  workerConnection.ts  one worker: the layers together
src/chat/      the chat and file preview views (Svelte 5, Tailwind 4), each talking to its host through a `Host`
```

## Agents

The client knows no agent by name. What an agent can do comes from its `initialize` answer: its prompt capabilities,
whether it resumes or loads sessions, its sign-in methods, and each session's settings (config options, or modes for
older agents). Update kinds the chat does not know reach it as sent. How an agent looks (name, color) comes from the
worker (`_codeflower/status`), with a fallback for the agents that predate that. Adding an agent to code flower is a
change to the sandbox and the app, not here.

## Using it

```sh
npm install github:lutrarutra/codeflower-ui#vX.Y.Z
```

```ts
import { WorkerConnection } from 'codeflower-ui/client/workerConnection.ts';
import { webSocketTransport } from 'codeflower-ui/client/transport.ts';

const connection = await WorkerConnection.connect(await webSocketTransport(url), handlers, { name: 'my-client', version: '1' });
```

Mount `codeflower-ui/chat/App.svelte` with a `host` (see `src/chat/lib/host.ts`) and import `codeflower-ui/chat/app.css`.
Set `cf-dark` on the body for the dark theme. Vite builds that use a linked checkout need `resolve.dedupe: ['svelte']`.

## Developing

```sh
npm install
npm run check
npm test
```
