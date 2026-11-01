<h1 align="center">code flower ui</h1>

<p align="center">The chat of code flower and the ACP client behind it.</p>

<p align="center">
  <a href="https://github.com/lutrarutra/codeflower-app"><img src="https://raw.githubusercontent.com/lutrarutra/codeflower-app/main/assets/icon.png" width="20" height="20" alt=""> app</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/lutrarutra/codeflower-sandbox"><img src="https://raw.githubusercontent.com/lutrarutra/codeflower-sandbox/main/assets/icon.png" width="20" height="20" alt=""> sandbox</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/lutrarutra/codeflower-vsc-extension"><img src="https://raw.githubusercontent.com/lutrarutra/codeflower-vsc-extension/main/media/icon.png" width="20" height="20" alt=""> VS Code extension</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/lutrarutra/storyteller"><img src="https://raw.githubusercontent.com/lutrarutra/storyteller/main/assets/icon.png" width="20" height="20" alt=""> storyteller</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/lutrarutra/codeflower-tunnel"><img src="https://raw.githubusercontent.com/lutrarutra/codeflower-tunnel/main/assets/icon.png" width="20" height="20" alt=""> tunnel</a>
  &nbsp;·&nbsp;
  <a href="https://docs.codeflower.app">docs.codeflower.app</a>
</p>

The chat views and the agent-agnostic ACP client of code flower, shared by the
[VS Code extension](https://github.com/lutrarutra/codeflower-vsc-extension) and the
[app](https://github.com/lutrarutra/codeflower-app)'s page. It ships as TypeScript and Svelte source,
compiled by each host's bundler (esbuild, Vite), so it has no build step of its own.

## Install

```sh
npm install github:lutrarutra/codeflower-ui#vX.Y.Z
```

```ts
import { WorkerConnection } from 'codeflower-ui/client/workerConnection.ts';
import { webSocketTransport } from 'codeflower-ui/client/transport.ts';

const connection = await WorkerConnection.connect(await webSocketTransport(url), handlers, { name: 'my-client', version: '1' });
```

Mount `codeflower-ui/chat/App.svelte` with a `host` (see `src/chat/lib/host.ts`) and import
`codeflower-ui/chat/app.css`. Set `cf-dark` on the body for the dark theme. Vite builds that use a
linked checkout need `resolve.dedupe: ['svelte']`.

## Contents

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

The client knows no agent by name. What an agent can do comes from its `initialize` answer (prompt
capabilities, resuming or loading sessions, sign-in methods, each session's settings); how it looks
(name, color) comes from the worker's `_codeflower/status`. Adding an agent is a change to the
sandbox and the app, not here.

## Development

```sh
npm install
npm run check
npm test
```

In [codeflower-workspace](https://github.com/lutrarutra/codeflower-workspace), `make ui-link` makes
the extension and the app use this checkout. Its [architecture document](https://github.com/lutrarutra/codeflower-workspace/blob/main/docs/architecture.md)
describes how the parts fit together.
