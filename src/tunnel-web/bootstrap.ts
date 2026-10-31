// /m/{connector}/ before the service worker runs: install it, then reload so
// it serves the app's page from the user's computer.

import { tunnelConnectorId } from '../tunnel/connect.ts';
import { pairedConnector } from '../tunnel/keys.ts';

function show(message: string, actions: Array<{ label: string; href: string }> = []): void {
  const status = document.getElementById('status')!;
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  const row = document.createElement('div');
  row.className = 'row';
  for (const action of actions) {
    const link = document.createElement('a');
    link.className = 'button';
    link.href = action.href;
    link.textContent = action.label;
    row.append(link);
  }
  status.replaceChildren(paragraph, row);
}

async function start(): Promise<void> {
  const connectorId = tunnelConnectorId();
  if (!connectorId) return show('This address names no computer.', [{ label: 'Your tunnel account', href: '/' }]);
  if (!(await pairedConnector(connectorId))) {
    return show(
      'This browser is not paired with that computer yet. On the computer, run "codeflower tunnel pair" and open the link it prints here.',
      [{ label: 'Your tunnel account', href: '/' }]
    );
  }
  if (!('serviceWorker' in navigator)) {
    return show('This browser cannot run the code that reaches your computer (service workers are off, e.g. in a private window).');
  }
  // A worker already controls the page but the tunnel served this page: it
  // could not answer. Reloading again would loop.
  const attempt = Number(sessionStorage.getItem('cft_bootstrap') ?? '0');
  if (navigator.serviceWorker.controller && attempt > 0) {
    sessionStorage.removeItem('cft_bootstrap');
    return show('Your computer could not be reached.', [{ label: 'Try again', href: location.href }]);
  }
  await navigator.serviceWorker.register('/sw.js', { scope: '/m/' });
  await navigator.serviceWorker.ready;
  sessionStorage.setItem('cft_bootstrap', String(attempt + 1));
  location.reload();
}

start().catch((error) => show(error instanceof Error ? error.message : String(error)));
