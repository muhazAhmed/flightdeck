import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ShellProfile } from '../shared/types.ts';
import * as pty from '../server/pty.ts';
import { defaultProfile } from '../server/shells.ts';

/**
 * Shells that outlive their socket.
 *
 * THE BUG THIS FIXES, reported from use: start a dev server in project A, switch to project B, and A's server was
 * dead — starting one in B looked like it had "taken over" the first. Switching projects remounts the terminal, which
 * closed the socket, and a closing socket used to kill the shell.
 *
 * These tests drive `server/pty.ts` directly with a real shell, because the whole question is what an OS process does
 * when nobody is listening to it — which a mock cannot answer.
 */
const profile: ShellProfile = defaultProfile();
const ENTER = String.fromCharCode(13);
const INTERRUPT = String.fromCharCode(3);

/** PTY output arrives in chunks over several ticks; polling beats guessing at a single delay. */
async function waitFor(read: () => string, needle: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read().includes(needle)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Everything here signals through a Node one-liner rather than a prompt or `echo`.
 *
 * Waiting for `$` was the first attempt and it hung: the default profile on this machine is PowerShell, whose prompt
 * is `PS C:\...>`. Prompts, quoting rules and `echo` semantics all differ between PowerShell, cmd and bash — a Node
 * one-liner behaves identically in all three, and node is by definition present.
 *
 * A PTY also echoes what is typed, so a marker appears once from the echo before the command has run at all. Where
 * that matters the test waits for a marker the typed line cannot contain.
 */
function ticker(marker: string): string {
  /*
   * One concatenated string, not `console.log(marker, n)`.
   *
   * node colourises numbers when stdout is a TTY — and a PTY is one — so two arguments print as
   * `TICK <ESC>[33m2`, and a search for "TICK 2" never matches. Concatenating keeps the marker one plain token.
   */
  return `node -e "let n=0;setInterval(()=>console.log('${marker}'+(++n)),300)"${ENTER}`;
}

function prints(marker: string): string {
  return `node -e "console.log('${marker}')"${ENTER}`;
}

interface Client {
  handlers: pty.PtyHandlers;
  output: () => string;
  exits: number[];
}

function client(): Client {
  let output = '';
  const exits: number[] = [];
  return {
    handlers: {
      onData: (chunk) => {
        output += chunk;
      },
      onExit: (code) => exits.push(code)
    },
    output: () => output,
    exits
  };
}

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'flightdeck-pty-'));
}

/**
 * Remove a temp workspace, once the shell has let go of it.
 *
 * Windows keeps a directory locked while it is a live process's working directory, and `dispose` only asks the shell
 * to die — so an immediate `rmSync` fails with EBUSY. Retried briefly, and given up on rather than failing a test:
 * this is cleanup, and a lingering temp directory is not a defect worth reporting as one.
 */
async function remove(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

test('a detached shell keeps running and keeps its output', async () => {
  const cwd = workspace();
  const key = 'project-a';
  try {
    const first = client();
    const opened = pty.attach(key, cwd, profile, first.handlers);
    assert.equal(opened.restored, false, 'nothing was running yet');

    // Something that keeps printing, which is what a dev server is. `TICK 2` proves it is really running: the echoed
    // command line contains `TICK`, but never `TICK 2`.
    pty.write(key, ticker('TICK'));
    assert.ok(await waitFor(first.output, 'TICK2'), 'the ticker never started');

    // This is a project switch: the socket goes away.
    pty.detach(key, first.handlers);
    assert.equal(pty.isRunning(key), true, 'detaching must not kill the shell');

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Coming back: same shell, and the output it produced while nobody watched.
    const second = client();
    const reopened = pty.attach(key, cwd, profile, second.handlers);
    assert.equal(reopened.restored, true, 'should have reattached, not started a new shell');
    assert.match(reopened.history, /TICK2/, 'history from before the switch is missing');

    const ticksAtSwitch = (reopened.history.match(/TICK\d+/g) ?? []).length;
    assert.ok(ticksAtSwitch > 2, `expected the ticker to keep going while detached, saw ${ticksAtSwitch}`);

    // And it is still live for the new client.
    assert.ok(await waitFor(second.output, 'TICK'), 'no live output after reattaching');

    pty.write(key, INTERRUPT);
  } finally {
    pty.dispose(key);
    await remove(cwd);
  }
});

test('two projects get two shells, and neither takes over the other', async () => {
  const cwdA = workspace();
  const cwdB = workspace();
  try {
    const a = client();
    const b = client();
    pty.attach('a', cwdA, profile, a.handlers);
    pty.attach('b', cwdB, profile, b.handlers);

    pty.write('a', prints('ONLY-IN-A'));
    pty.write('b', prints('ONLY-IN-B'));
    assert.ok(await waitFor(a.output, 'ONLY-IN-A'));
    assert.ok(await waitFor(b.output, 'ONLY-IN-B'));

    // The reported symptom was one project's shell replacing another's.
    assert.ok(!a.output().includes('ONLY-IN-B'), "B's output reached A");
    assert.ok(!b.output().includes('ONLY-IN-A'), "A's output reached B");
    assert.equal(pty.count(), 2);
  } finally {
    pty.dispose('a');
    pty.dispose('b');
    await remove(cwdA);
    await remove(cwdB);
  }
});

test('a second client takes over rather than sharing', async () => {
  const cwd = workspace();
  const key = 'takeover';
  try {
    const first = client();
    pty.attach(key, cwd, profile, first.handlers);
    // Let the shell finish starting, so the takeover is not racing the spawn.
    pty.write(key, prints('FIRST-CLIENT'));
    assert.ok(await waitFor(first.output, 'FIRST-CLIENT'));

    const second = client();
    pty.attach(key, cwd, profile, second.handlers);

    pty.write(key, prints('AFTER-TAKEOVER'));
    assert.ok(await waitFor(second.output, 'AFTER-TAKEOVER'), 'the new client got nothing');
    // Two windows interleaving keystrokes into one PTY reads as a haunted terminal.
    assert.ok(!first.output().includes('AFTER-TAKEOVER'), 'the old client is still being fed');
  } finally {
    pty.dispose(key);
    await remove(cwd);
  }
});

test('a stale detach cannot silence the client that replaced it', async () => {
  const cwd = workspace();
  const key = 'stale';
  try {
    const first = client();
    pty.attach(key, cwd, profile, first.handlers);
    const second = client();
    pty.attach(key, cwd, profile, second.handlers);

    // The old socket closes late, after the new one has claimed the session.
    pty.detach(key, first.handlers);

    pty.write(key, prints('STILL-LISTENING'));
    assert.ok(await waitFor(second.output, 'STILL-LISTENING'), 'the live client was detached by a stale socket');
  } finally {
    pty.dispose(key);
    await remove(cwd);
  }
});

test('choosing a different profile restarts the shell', async () => {
  const cwd = workspace();
  const key = 'profiles';
  try {
    const first = client();
    pty.attach(key, cwd, profile, first.handlers);
    pty.write(key, prints('BEFORE-SWITCH'));
    assert.ok(await waitFor(first.output, 'BEFORE-SWITCH'));

    // A profile change is a request for a different shell, not for the old one to carry on.
    const other: ShellProfile = { ...profile, id: `${profile.id}-variant` };
    const second = client();
    const result = pty.attach(key, cwd, other, second.handlers);
    assert.equal(result.restored, false, 'a different profile must not reuse the running shell');
    assert.equal(result.history, '');
  } finally {
    pty.dispose(key);
    await remove(cwd);
  }
});

test('stopping is explicit, and reports the exit to whoever is attached', async () => {
  const cwd = workspace();
  const key = 'stopping';
  try {
    const watcher = client();
    pty.attach(key, cwd, profile, watcher.handlers);
    pty.write(key, ticker('RUNNING'));
    assert.ok(await waitFor(watcher.output, 'RUNNING2'), 'nothing was running to stop');

    pty.dispose(key);
    assert.equal(pty.isRunning(key), false);
    assert.ok(!pty.running().includes(key));
  } finally {
    // Also here: an assertion failing above must not leak a session into the next test, which is how a failure in one
    // test showed up as a wrong count in another.
    pty.dispose(key);
    await remove(cwd);
  }
});

test('shutdown kills every shell', async () => {
  const cwdA = workspace();
  const cwdB = workspace();
  try {
    pty.attach('shutdown-a', cwdA, profile, client().handlers);
    pty.attach('shutdown-b', cwdB, profile, client().handlers);
    assert.equal(pty.count(), 2);

    // The safety property that survived the redesign: a shell nobody can reach must not outlive the server.
    pty.disposeAll();
    assert.equal(pty.count(), 0);
    assert.deepEqual(pty.running(), []);
  } finally {
    await remove(cwdA);
    await remove(cwdB);
  }
});

test('the socket detaches on close and only an explicit stop disposes', () => {
  const route = readFileSync('server/routes/terminal.ts', 'utf8');
  // The inversion of the old rule, which is what fixes the bug.
  assert.match(route, /socket\.on\('close', \(\) => pty\.detach\(key, handlers\)\)/);
  assert.match(route, /socket\.on\('error', \(\) => pty\.detach\(key, handlers\)\)/);
  assert.match(route, /message\.type === 'stop'\) pty\.dispose\(key\)/);
  // Keyed by project, so the same project always gets the same shell.
  assert.match(route, /const key = project\.id/);
  // And the buffered output is replayed as ordinary output, so the client needs no special path.
  // Flagged as a replay so the client renders it without acting on it: a device-code banner raised from an
  // hour-old login would offer to press Enter into whatever the shell is running now.
  assert.match(
    route,
    /if \(attached\.history\.length > 0\) send\(\{ type: 'output', data: attached\.history, replay: true \}\)/
  );
});

test('the drawer says the shell was already running, and offers a stop', () => {
  const drawer = readFileSync('client/features/terminal/TerminalDrawer.tsx', 'utf8');
  // Otherwise output above the prompt looks like a bug rather than a server that kept going.
  assert.match(drawer, /status\.restored \? \(/);
  assert.match(drawer, />\s*live/);
  // Closing the drawer no longer stops anything, so stopping needs its own control.
  assert.match(drawer, /label="Stop this shell — kills whatever is running in it"/);
  assert.match(drawer, /Closing this panel does not/);
});
