/**
 * Start Flight Deck and open it in a browser.
 *
 * What a pinned shortcut runs. Three jobs, in order:
 *
 *   1. If it is already running, just open the tab. Double-clicking the icon twice should not try to start a
 *      second server and fail on a taken port.
 *   2. Otherwise start `npm run dev` and leave it attached to this window, so the console stays as the log. Closing
 *      the window stops the server, which is the behaviour people expect of a thing they launched.
 *   3. Wait for the client to actually answer before opening the browser. Opening it immediately shows a connection
 *      error for the second or two Vite takes to bind, which reads as "it is broken".
 *
 * Plain Node with no dependencies, because a launcher that needs `npm install` to have worked is no use when the
 * thing you are debugging is the install.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Vite serves the client in dev; Fastify is on 5174 behind its proxy.
 *
 * `localhost` rather than `127.0.0.1`, and that is not cosmetic: on this machine Vite binds **only** to `[::1]`, so
 * polling the IPv4 address returned ECONNREFUSED forever and the launcher gave up after 90 seconds while the server
 * was running perfectly. `localhost` lets the resolver pick the family, which is also the URL Vite itself prints.
 */
const CLIENT_URL = 'http://localhost:5173';

/** Long enough for a cold Vite start on a slow disk, short enough to fail rather than hang forever. */
const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 400;

const root = fileURLToPath(new URL('..', import.meta.url));

/** True when something is already answering on the client port. */
async function isUp() {
  try {
    // `signal` matters: without a timeout a half-open socket makes the poll hang instead of retrying.
    const response = await fetch(CLIENT_URL, { signal: AbortSignal.timeout(1500) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Open a URL in the user's default browser.
 *
 * Each platform has exactly one way to do this and none of them agree. Windows needs `start` through the shell —
 * and the empty string is not a mistake, it is `start`'s title argument, without which a quoted URL is read as the
 * window title and nothing opens.
 */
function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUp()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

if (await isUp()) {
  console.log('Flight Deck is already running — opening the tab.');
  openBrowser(CLIENT_URL);
  process.exit(0);
}

console.log(`Starting Flight Deck in ${root}`);
console.log('Close this window to stop it.\n');

/**
 * `shell: true` on Windows because `npm` is a `.cmd` shim, which `CreateProcess` cannot execute directly — the same
 * reason server/cli.ts resolves the claude binary the way it does.
 */
const child = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('error', (error) => {
  console.error(`\nCould not start npm: ${error.message}`);
  console.error('Is Node installed and on your PATH?');
  process.exit(1);
});

// The server keeps running in this window; only the browser opening is conditional on it coming up.
void waitUntilReady().then((ready) => {
  if (ready) {
    openBrowser(CLIENT_URL);
    return;
  }
  console.error(`\nFlight Deck did not answer on ${CLIENT_URL} within ${READY_TIMEOUT_MS / 1000}s.`);
  console.error('The log above should say why. The server is still running in this window.');
});

// A shortcut's window closing must take the server with it, rather than leaving it holding the port.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill();
    process.exit(0);
  });
}

child.on('exit', (code) => process.exit(code ?? 0));
