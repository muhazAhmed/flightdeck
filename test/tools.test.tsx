import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ToolStatus } from '../shared/types.ts';
import {
  firstManager,
  ghLoginWithToken,
  ghInstallCommand,
  managersFor,
  parseGhAccount,
  parseGhVersion,
  probe,
  read
} from '../server/tools.ts';
import { ToolCard } from '../client/features/tools/ToolGate.tsx';

/**
 * Detecting tools Flight Deck does not ship.
 *
 * Driven against the real machine wherever it can be, because the interesting failure here was invisible to
 * any mock: the first version probed `PATH` with `existsSync` and reported `winget` missing on a machine that
 * runs it fine. See the note on app execution aliases below.
 */
test('a command that exists is found, and one that does not is not', async () => {
  // `git` is the positive control — the whole app requires it, so if this fails the test machine is the
  // problem rather than the code. Without a control, "nothing was found" and "nothing works" look identical.
  const git = await probe('git', ['--version']);
  assert.equal(git.found, true, 'git must be present to develop this project');
  assert.equal(git.ok, true);
  assert.match(git.stdout, /^git version /);

  const nonsense = await probe('flightdeck-no-such-command', ['--version']);
  assert.equal(nonsense.found, false);
  assert.equal(nonsense.ok, false);
  // Nothing to quote: "no such command" is not the tool's own words, it is the OS's.
  assert.equal(nonsense.detail, null);
});

test('a tool that runs and exits non-zero is found, not missing', async () => {
  /*
   * This is the distinction the whole gate rests on. `gh auth status` exits 1 when nobody is logged in, and
   * treating a non-zero exit as "not installed" would tell someone with gh installed to install gh.
   */
  const failing = await probe('git', ['rev-parse', '--verify', 'refs/heads/definitely-not-a-branch']);
  assert.equal(failing.found, true);
  assert.equal(failing.ok, false);
});

test('detection asks the OS to resolve a command rather than statting PATH', async () => {
  const source = readFileSync('server/tools.ts', 'utf8');
  /*
   * THE BUG THIS REPLACED. `winget` lives at `%LOCALAPPDATA%/Microsoft/WindowsApps/winget.exe`, an app
   * execution alias — a zero-length reparse point that `stat` cannot resolve. Measured on the machine this
   * was written on: existsSync false, statSync ENOENT, and `execFile('winget', ['--version'])` printing
   * v1.29.280. Anything Store-installed has that shape, so a filesystem probe silently under-reports.
   */
  // The call, not the word: the reasoning above mentions `existsSync` and should keep being allowed to.
  assert.ok(!/existsSync\(/.test(source), 'tools.ts must not probe the filesystem for a command');
  assert.ok(!/from 'node:fs'/.test(source), 'no filesystem probing at all');
  assert.match(source, /execFile/);

  // And the claim itself, on the machine running the test, where an alias exists to check against.
  const alias = `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WindowsApps\\winget.exe`;
  if (process.platform === 'win32' && (await probe('winget', ['--version'])).found) {
    assert.equal(existsSync(alias), false, 'if this ever starts passing, Windows changed how aliases work');
  }
});

const commandsFor = (platform: NodeJS.Platform) => managersFor(platform).map((spec) => spec.ghInstall);
const idsFor = (platform: NodeJS.Platform) => managersFor(platform).map((spec) => spec.id);

test('each OS gets its own managers, and only its own', () => {
  assert.deepEqual(idsFor('win32'), ['winget', 'choco', 'scoop']);
  assert.deepEqual(idsFor('darwin'), ['brew', 'port']);
  assert.deepEqual(idsFor('linux'), ['dnf', 'pacman', 'zypper', 'apk', 'brew']);
});

test('a Windows machine carrying MSYS2 can never be handed a sudo pacman command', () => {
  /*
   * THE BUG THIS FIXES. One global manager list meant the first manager found won, wherever it came from — so
   * a Windows box with MSYS2's `pacman` on PATH and no winget was told `sudo pacman -S github-cli`: no sudo to
   * run it, and a package set that does not contain that package. Being present is not being appropriate.
   */
  for (const command of commandsFor('win32')) {
    assert.ok(!command.includes('sudo'), `${command} assumes a Unix machine`);
    assert.ok(!/\b(pacman|dnf|apk|zypper)\b/.test(command), `${command} is not a Windows manager`);
  }
});

test('a privileged command only ever appears where privilege is how installing works', () => {
  // Homebrew installs into its own prefix on purpose, so `sudo brew` is actively wrong — it refuses.
  for (const command of [...commandsFor('darwin'), ...commandsFor('linux')]) {
    if (command.startsWith('brew')) assert.ok(!command.includes('sudo'), 'brew must never be run with sudo');
  }
  // And nothing on Windows asks for a privilege escalation it has no way to perform in a plain shell.
  assert.deepEqual(commandsFor('win32').filter((c) => c.includes('sudo')), []);
});

test('each command actually invokes the manager it belongs to, with the right package name', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    for (const spec of managersFor(platform)) {
      assert.match(spec.ghInstall, new RegExp(`^(sudo )?${spec.id}\\b`), `${spec.ghInstall} is not a ${spec.id} command`);
      // Arch and Alpine ship it as `github-cli`; everyone else calls it `gh`. A wrong name is a failed install.
      const expected = spec.id === 'pacman' || spec.id === 'apk' ? 'github-cli' : 'gh';
      assert.match(spec.ghInstall, new RegExp(`(^|\\s)(--id GitHub\\.cli|${expected})(\\s|$)`), spec.ghInstall);
    }
  }
});

test('an unrecognised platform is given no command rather than a guess', () => {
  // BSD, and whatever comes next. No command is a better answer than a wrong one; the docs cover everyone.
  assert.deepEqual(managersFor('freebsd'), []);
  assert.equal(ghInstallCommand(null), null);
});

test('the command offered on this machine belongs to a manager that answered', async () => {
  const manager = await firstManager();
  const command = ghInstallCommand(manager);
  if (manager === null) {
    assert.equal(command, null);
    return;
  }
  // Probed from this platform's list only, so a found manager is by construction one that suits this OS.
  assert.ok(idsFor(process.platform).includes(manager.id), `${manager.id} is not offered on ${process.platform}`);
  assert.match(command ?? '', new RegExp(`^(sudo )?${manager.id}\\b`));
});

test('apt is deliberately not offered', () => {
  const source = readFileSync('server/tools.ts', 'utf8');
  // The official Debian/Ubuntu route adds a keyring and an apt source first; a three-command privileged
  // sequence typed into a terminal by a button is not something anyone should accept on trust.
  assert.ok(!/'apt'/.test(source), 'apt would need a multi-step privileged sequence — docs instead');
  assert.match(source, /docsUrl/);
});

test('a version string is parsed, and an unexpected one is still shown', () => {
  // Real output carries a release-notes link on the second line; the first line is all this reads.
  assert.equal(parseGhVersion('gh version 2.63.2 (2024-12-19)\nrelease notes follow'), '2.63.2');
  // Better to show a line we did not understand than to show nothing: it still says which build answered.
  assert.equal(parseGhVersion('something else entirely'), 'something else entirely');
  assert.equal(parseGhVersion(''), null);
});

test('the signed-in account is read from gh\'s own report', () => {
  const report = '✓ Logged in to github.com account octocat (keyring)\n  - Active account: true';
  assert.equal(parseGhAccount(report), 'octocat');
  assert.equal(parseGhAccount('You are not logged into any GitHub hosts.'), null);
});

test('reading is cached, and a refresh re-probes', async () => {
  const first = await read();
  const cached = await read();
  // Cached because `gh auth status` is a network round trip; the PR page must not pay it per render.
  assert.equal(cached.checkedAt, first.checkedAt);

  const fresh = await read({ refresh: true });
  // The escape hatch matters more than the cache: whoever pressed "check again" just installed something.
  assert.notEqual(fresh.checkedAt, first.checkedAt);
  assert.equal(fresh.tools.length, 1);
  assert.equal(fresh.tools[0]?.id, 'gh');
});

test('gh reports three states, not two', async () => {
  const { tools } = await read({ refresh: true });
  const gh = tools[0] as ToolStatus;
  // Not installed → `authenticated` is unknown rather than false: claiming "not signed in" about a tool that
  // is not there would send the user to the wrong instruction.
  if (!gh.installed) {
    assert.equal(gh.authenticated, null);
    assert.equal(gh.version, null);
  } else {
    assert.equal(typeof gh.authenticated, 'boolean');
  }
});

test('nothing in the detection path installs anything', () => {
  const source = readFileSync('server/tools.ts', 'utf8');
  for (const forbidden of ['install ', 'winget install', 'brew install']) {
    // The install strings exist as DATA handed to the UI. What must not exist is a call that runs one.
    assert.ok(source.includes(forbidden), 'the commands are still offered as text');
  }
  // The only spawns are probes: a version flag, an auth status, a `where`/`which`.
  const spawns = source.match(/run\(/g) ?? [];
  assert.equal(spawns.length, 1, 'one spawn helper, used by probe alone');
});

test('there is no postinstall hook', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  /*
   * `npm install` runs non-interactively under `npm ci`, in CI and in Docker. A prompt there hangs a build
   * with no explanation, which is the first impression a new contributor would get.
   */
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(pkg.scripts.preinstall, undefined);
});

const render = (tool: Partial<ToolStatus>) => {
  const full: ToolStatus = {
    id: 'gh',
    label: 'GitHub CLI',
    command: 'gh',
    purpose: 'Reading pull requests and their diffs.',
    docsUrl: 'https://github.com/cli/cli#installation',
    installed: false,
    version: null,
    path: null,
    authenticated: null,
    account: null,
    installCommand: 'winget install --id GitHub.cli --source winget',
    installManager: 'winget',
    authCommand: 'gh auth login',
    tokenUrl: 'https://github.com/settings/tokens/new?scopes=repo,read:org,gist&description=Flight%20Deck',
    detail: null,
    ...tool
  };
  // The gate fetches on mount; server rendering stops at the skeleton, so the card is rendered directly.
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <ToolCard tool={full} checks={0} loading={false} onRecheck={() => {}} />
    </Tooltip.Provider>
  );
};

test('a missing tool is told how to install it, in the words of this machine', () => {
  const html = render({});
  assert.match(html, /GitHub CLI is not installed/);
  assert.match(html, /winget install --id GitHub\.cli/);
  // Which manager it came from is named: the same tool is `sudo pacman -S github-cli` on Arch, and an
  // unexplained command is one you have to go and verify before you trust it.
  assert.match(html, /Using winget, which is what this machine has/);
  // And says where it will run, because "a button that installs software" is a thing to be suspicious of.
  assert.match(html, /Nothing is\s+installed in the background/);
});

test('a tool that is present but not signed in gets the login step, not the install step', () => {
  const html = render({ installed: true, version: '2.63.2', authenticated: false, detail: 'not logged in' });
  assert.match(html, /GitHub CLI is not signed in/);
  assert.match(html, /gh auth login/);
  assert.ok(!/winget install/.test(html), 'never tell someone to install what they already have');
  // gh's own words, verbatim.
  assert.match(html, /not logged in/);
});

test('a machine with no known package manager is given the docs, not a guess', () => {
  const html = render({ installCommand: null });
  assert.match(html, /No package manager we recognise/);
  assert.match(html, /Installation docs/);
  assert.ok(!/Install it, in the terminal/.test(html));
});

test('the restart note appears only after an actual re-check', () => {
  // A running process keeps the PATH it started with, so a tool installed a minute ago is invisible until
  // Flight Deck restarts. Shown before a re-check it would be a warning about nothing.
  assert.ok(!/Restart Flight Deck/.test(render({})));
  const html = renderToStaticMarkup(
    <Tooltip.Provider>
      <ToolCard
        tool={{
          id: 'gh',
          label: 'GitHub CLI',
          command: 'gh',
          purpose: 'p',
          docsUrl: 'd',
          installed: false,
          version: null,
          path: null,
          authenticated: null,
          account: null,
          installCommand: 'winget install --id GitHub.cli --source winget',
          installManager: 'winget',
          authCommand: 'gh auth login',
          tokenUrl: null,
          detail: null
        }}
        checks={1}
        loading={false}
        onRecheck={() => {}}
      />
    </Tooltip.Provider>
  );
  assert.match(html, /Restart Flight Deck/);
  assert.match(html, /keeps the PATH it started with/);
});

test('the PR button is not disabled when the tool is missing', () => {
  const sidebar = readFileSync('client/features/projects/ProjectSidebar.tsx', 'utf8');
  // A disabled button with a tooltip is a dead end; the same click should land somewhere that explains
  // itself and offers the fix.
  assert.match(sidebar, /label="PR"/);
  assert.match(sidebar, /toggleView\('pr'\)/);
});

test('running the command does not navigate away from the page that offered it', () => {
  const gate = readFileSync('client/features/tools/ToolGate.tsx', 'utf8');
  /*
   * THE UX BUG THIS FIXES, reported from use: pressing "install" switched to the workspace view, because that
   * is where the terminal used to live. The install ran — in the last project's shell, on a page the reader
   * had not asked for — and the feature still felt broken.
   */
  assert.ok(!/setView\(/.test(gate), 'the gate must not change view');
  assert.match(gate, /onClick=\{\(\) => runInTerminal\(command\)\}/);
  assert.match(gate, /the terminal at the bottom of this page/);

  // And the page that offers a command hosts one, using the same drawer and the same session as the workspace.
  const page = readFileSync('client/features/pr/PrPage.tsx', 'utf8');
  assert.match(page, /terminal: ReactNode/);
  assert.match(page, /\{terminal && project \? /);

  const shell = readFileSync('client/app/AppShell.tsx', 'utf8');
  assert.match(shell, /terminal=\{terminalOpen \? terminalNode\('plain'\) : null\}/);
  assert.match(shell, /\{terminalNode\('workspace'\)\}/);
});

test('a terminal opened to run one command carries no project git actions', () => {
  const drawer = readFileSync('client/features/terminal/TerminalDrawer.tsx', 'utf8');
  // Installing a missing tool is no place to be offered a build trigger or a branch move.
  assert.match(drawer, /variant\?: 'workspace' \| 'plain'/);
  assert.match(drawer, /variant === 'workspace' \? <FastForwardButton/);
  // The shell itself is unchanged: same session, same project, still stoppable and clearable.
  assert.match(drawer, /label="Clear the terminal"/);
  assert.match(drawer, /label="Stop this shell/);
});

test('a token is validated before gh ever sees it', async () => {
  // A paste accident (two lines, a stray space, half a page) would otherwise have gh report a confusing error
  // about a token it never received.
  const twoLines = ['first', 'second'].join(String.fromCharCode(10));
  for (const bad of ['', '   ', 'has a space', twoLines, 'x'.repeat(600)]) {
    const result = await ghLoginWithToken(bad);
    assert.equal(result.ok, false, JSON.stringify(bad.slice(0, 20)));
    assert.ok((result.detail ?? '').length > 0, 'a refusal must say why');
  }
});

test('the token goes in on stdin, never in argv', () => {
  const source = readFileSync('server/tools.ts', 'utf8');
  /*
   * argv is visible to anything that can list processes, so a token passed as an argument is a token leaked to
   * every other user on the machine.
   */
  assert.match(source, /spawn\('gh', \['auth', 'login', '--with-token'\]/);
  assert.match(source, /child\.stdin\.end\(trimmed \+ NEWLINE\)/);

  // The argv line itself, with the flag's own name taken out, must not mention a token at all — that is what
  // rules out someone later "simplifying" it into an argument.
  const argv = source.split(String.fromCharCode(10)).find((line) => line.includes("spawn('gh'")) ?? '';
  assert.ok(!argv.replace("'--with-token'", '').includes('token'), `the token must not be in argv: ${argv}`);
});

test('nothing stores, logs or echoes the token', () => {
  const source = readFileSync('server/tools.ts', 'utf8');
  const route = readFileSync('server/routes/tools.ts', 'utf8');
  // gh puts it in the system credential store; keeping a second copy in state.json would be strictly worse.
  assert.ok(!/state\.(write|update)/.test(source), 'tools.ts must not write state');
  assert.ok(!/console\.(log|info|warn|error)/.test(source), 'never log around a token');
  // The response is the re-probed status. Sending the token back would put it in the network log of a browser.
  assert.match(route, /return tools\.read\(\{ refresh: true \}\)/);
  assert.ok(!/token:/.test(route.slice(route.indexOf('reply.code(400)'))), 'the failure must not echo it');
});

test('a failed login answers with gh own words and a 400', () => {
  const route = readFileSync('server/routes/tools.ts', 'utf8');
  assert.match(route, /reply\.code\(400\)/);
  assert.match(route, /detail: result\.detail/);
  assert.match(route, /code: 'GH_LOGIN_FAILED'/);
});

test('signing in replaces the device-code flow as the primary path', () => {
  const html = render({ installed: true, version: '2.97.0', authenticated: false });
  // The form, not a command to run: the terminal route is what proved unreliable.
  assert.match(html, /Create a token on GitHub/);
  assert.match(html, /scopes already ticked: repo, read:org, gist/);
  assert.match(html, /type="password"/);
  // And the CLI's own flow is still offered, demoted.
  assert.match(html, /Or run gh auth login in the terminal/);
  // Said out loud, because handing a token to a local web app deserves an explanation.
  assert.match(html, /keeps it in your system credential store/);
});

test('the install step shows no token form', () => {
  // Nothing to sign into yet, and a form for a tool that is absent is noise.
  const html = render({ installed: false });
  assert.ok(!/type="password"/.test(html));
});

test('a rejected token is kept in the field', () => {
  const gate = readFileSync('client/features/tools/ToolGate.tsx', 'utf8');
  // Wiping it means retyping the whole thing to fix one character.
  assert.match(gate, /if \(ok\) setToken\(''\)/);
});
