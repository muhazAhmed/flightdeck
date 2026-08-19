/**
 * Create a desktop launcher for this checkout.
 *
 * GENERATED, NEVER COMMITTED. A shortcut embeds absolute paths — the repository location, the node binary, the icon —
 * so it is meaningless on anyone else's machine and would be the exact kind of hardcoded path this project forbids.
 * It is written to the desktop of whoever runs `npm run shortcut`, and `.gitignore` keeps any stray copy out.
 *
 * Windows gets a `.lnk`, which is the only thing Start and the taskbar will pin. macOS gets a `.command` and Linux a
 * `.desktop`, both of which double-click the same way.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const launcher = join(root, 'scripts', 'launch.mjs');
const icon = join(root, 'public', 'favicon.ico');
const NAME = 'Flight Deck';

/**
 * Where the desktop actually is.
 *
 * `~/Desktop` is a guess, and on Windows it is frequently wrong: this was written on a machine where the desktop is
 * redirected to `~/OneDrive/Desktop`, so the first shortcut landed in the home directory instead. Windows knows the
 * answer, so it is asked — `GetFolderPath` follows the redirection, and a localised folder name comes back correct
 * too. Elsewhere `~/Desktop` is reliable, with the home directory as a last resort.
 */
function desktop() {
  if (process.platform === 'win32') {
    try {
      const resolved = execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('Desktop')"],
        { encoding: 'utf8' }
      ).trim();
      if (resolved && existsSync(resolved)) return resolved;
    } catch {
      // Fall through to the guess below rather than failing over a shortcut's location.
    }
  }
  const guess = join(homedir(), 'Desktop');
  return existsSync(guess) ? guess : homedir();
}

/** Build the icon if it is not there yet, so `npm run shortcut` works on a fresh clone. */
function ensureIcon() {
  if (existsSync(icon)) return;
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'make-icon.mjs')], { stdio: 'inherit' });
  } catch {
    console.warn('Could not build the icon; the shortcut will use the default one.');
  }
}

function windows() {
  const target = join(desktop(), `${NAME}.lnk`);

  /*
   * Built through PowerShell's WScript.Shell, which is the only way to write a .lnk without a dependency.
   *
   * `cmd /k` rather than `/c`: the window has to stay open, because it is the server's log and closing it is how you
   * stop the thing. The arguments are single-quoted for PowerShell and double-quoted for cmd, since the repository
   * path can contain spaces — which is exactly the case that silently produces a broken shortcut.
   */
  const script = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${target}')`,
    `$s.TargetPath = '${process.env.COMSPEC ?? 'cmd.exe'}'`,
    // One pair of double quotes, not two. PowerShell's single-quoted strings need no escaping for `"`, and the
    // doubled form this originally used produced `node ""path""`, which cmd passes through verbatim and node then
    // cannot resolve. Caught by running the command rather than by reading the shortcut back.
    `$s.Arguments = '/k node "${launcher}"'`,
    `$s.WorkingDirectory = '${root}'`,
    `$s.Description = 'Start Flight Deck and open it in a browser'`,
    existsSync(icon) ? `$s.IconLocation = '${icon}'` : '',
    `$s.Save()`
  ]
    .filter(Boolean)
    .join('; ');

  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
  return target;
}

function macos() {
  const target = join(desktop(), `${NAME}.command`);
  // A .command is just a shell script the Finder will run; `cd` first so a relative npm resolution still works.
  writeFileSync(target, `#!/bin/sh\ncd "${root}" || exit 1\nexec node "${launcher}"\n`, 'utf8');
  chmodSync(target, 0o755);
  return target;
}

function linux() {
  const applications = join(homedir(), '.local', 'share', 'applications');
  mkdirSync(applications, { recursive: true });
  const target = join(applications, 'flightdeck.desktop');
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${NAME}`,
    'Comment=Start Flight Deck and open it in a browser',
    `Exec=node ${launcher}`,
    `Path=${root}`,
    `Icon=${join(root, 'public', 'logo.png')}`,
    // Terminal=true keeps the log visible, and closing it stops the server.
    'Terminal=true',
    'Categories=Development;'
  ].join('\n');
  writeFileSync(target, `${entry}\n`, 'utf8');
  chmodSync(target, 0o755);
  return target;
}

ensureIcon();

let created;
try {
  created = process.platform === 'win32' ? windows() : process.platform === 'darwin' ? macos() : linux();
} catch (error) {
  console.error(`Could not create the shortcut: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

console.log(`\nCreated: ${created}`);
if (process.platform === 'win32') {
  console.log('Right-click it → Pin to Start, or drag it onto the taskbar.');
} else if (process.platform === 'linux') {
  console.log('It will appear in your application menu; pin it from there.');
} else {
  console.log('Drag it to the Dock to keep it.');
}
console.log('Clicking it starts the dev server and opens the browser once it answers.');
