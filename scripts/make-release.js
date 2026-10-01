// Builds the shareable zip: copies an allow-list of files into release/cc-watcher/, scans the copy for private
// details and stops on any hit, then zips it.
//   node scripts/make-release.js                 build + scan + zip
//   node scripts/make-release.js --scan <path>   scan only: a folder, a file, or an Electron app.asar
// Besides the patterns below it always looks for this computer's user name and machine name, plus any extra words
// listed in release.private.json ({ "extra": ["word", ...] }) — that file stays out of the release.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'release');
const DIR = path.join(OUT, 'cc-watcher');
const INCLUDE = ['server.js', 'package.json', 'package-lock.json', 'README.md', 'HOW-IT-WORKS.md', 'LICENSE', '.gitignore', 'start.bat', 'start.sh', 'SETUP-GUIDE.md', 'guide', 'public', 'test', 'electron', 'scripts'];
const SKIP = new Set(['node_modules', '.bak', 'progress.json', 'project.json', 'desktop.json']);
// Placeholders the docs and demo use on purpose.
const ALLOW = ['your-pc.your-tailnet.ts.net', '/home/demo/', '-home-demo-', 'i@izs.me' /* an npm package author, public */];
const BINARY = /\.(?:gif|png|ico|jpe?g|webp)$/i; // pictures: private words only — random bytes can look like an email

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function patterns() {
  const extra = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'release.private.json'), 'utf8')).extra ?? []; } catch { return []; } })();
  // User and machine names as whole words (a short name must not flag longer words); extra words anywhere ("brand" in "brandlabs").
  const words = [os.userInfo().username, os.hostname()].filter(w => w?.length >= 3).map(w => `\\b${esc(w)}\\b`);
  return [
    ...[...words, ...extra.filter(w => w?.length >= 3).map(esc)].map(w => [`private word /${w}/`, new RegExp(w, 'i')]),
    ['Windows user folder', /[A-Za-z]:\\{1,2}Users\\{1,2}(?!Public\b)[\w .-]+/i],
    ['home folder', /\/(?:Users|home)\/(?!demo\/|runner\/|<)[\w.-]+/],
    ['Tailscale address', /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/],
    ['Tailscale name', /\b[\w-]+\.[\w-]+\.ts\.net\b/i],
    ['email address', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/i],
    ['API key / token', /\b(?:sk-(?:ant-)?[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|xox[abprs]-[\w-]{10,})/],
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];
}

function* files(p) {
  if (!fs.statSync(p).isDirectory()) return yield p;
  for (const e of fs.readdirSync(p)) if (e !== '.git') yield* files(path.join(p, e));
}

function scan(target) {
  let root = target, tmp;
  if (target.endsWith('.asar')) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-scan-'));
    require('@electron/asar').extractAll(target, tmp);
    root = tmp;
  }
  const pats = patterns(), hits = [];
  for (const f of files(root)) {
    if (f.endsWith('.asar')) { hits.push(...scan(f)); continue; }
    let text = fs.readFileSync(f).toString('latin1');
    for (const a of ALLOW) text = text.split(a).join('');
    // Third-party packages carry their authors' public emails and doc examples; only our own leaks matter there.
    const use = BINARY.test(f) || /\.(?:exe|dll|pak|bin|dat)$/i.test(f) ? pats.filter(([name]) => name.startsWith('private word'))
      : /[\\/]node_modules[\\/]/.test(f) ? pats.filter(([name]) => !['email address', 'home folder'].includes(name)) : pats;
    text.split('\n').forEach((line, i) => {
      for (const [name, re] of use) {
        const m = line.match(re);
        if (m) hits.push(`${path.relative(root, f) || path.basename(f)}:${i + 1}  ${name}: ${m[0].slice(0, 60)}`);
      }
    });
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  return hits;
}

function report(hits, what) {
  if (!hits.length) return console.log(`Privacy scan: clean (${what})`);
  console.error(`Privacy scan FAILED (${what}) — ${hits.length} hit(s):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}

const i = process.argv.indexOf('--scan');
if (i > 0) {
  const t = path.resolve(process.argv[i + 1] ?? '');
  report(scan(t), t);
} else {
  // Clear the last build but keep release/cc-watcher/.git: the published GitHub repo's history lives there.
  const clear = (dir, keep) => fs.existsSync(dir) && fs.readdirSync(dir).filter(e => e !== keep)
    .forEach(e => fs.rmSync(path.join(dir, e), { recursive: true, force: true }));
  clear(OUT, 'cc-watcher'); clear(DIR, '.git');
  for (const name of INCLUDE) {
    fs.cpSync(path.join(ROOT, name), path.join(DIR, name), { recursive: true, filter: src => !SKIP.has(path.basename(src)) });
  }
  report(scan(DIR), 'release/cc-watcher');
  const { version } = require(path.join(ROOT, 'package.json'));
  const zip = path.join(OUT, `cc-watcher-${version}.zip`);
  // bsdtar (Windows 10+, macOS) writes zips; elsewhere fall back to zip. On Windows name it outright, since Git's GNU
  // tar may come first on PATH and can't.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  try { execFileSync(tar, ['-a', '-cf', zip, '--exclude', 'cc-watcher/.git', 'cc-watcher'], { cwd: OUT, stdio: 'pipe' }); }
  catch { execFileSync('zip', ['-qr', zip, 'cc-watcher', '-x', 'cc-watcher/.git/*'], { cwd: OUT }); }
  console.log(`Release: ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`);
}
