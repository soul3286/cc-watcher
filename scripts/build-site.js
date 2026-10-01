// Assembles the GitHub Pages site into release/cc-watcher/docs: the landing page (site/), its media, and a copy of the
// dashboard (public/) forced into server-free demo mode. Run by make-release; also `npm run site`.
// Media need ffmpeg. The 720p web video is slow to encode, so it is cached in video/out/web/ and only redone when the
// master is newer.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'release', 'cc-watcher', 'docs');
const MASTER = path.join(ROOT, 'video', 'out', 'cc-watcher-showcase.mp4');
const CACHE = path.join(ROOT, 'video', 'out', 'web');
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const stale = (out, src) => !fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs;

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(OUT, 'demo'), { recursive: true });
const demo = path.join(OUT, 'demo', 'index.html');
const html = fs.readFileSync(demo, 'utf8');
if (!html.includes('<script src="demo.js">')) throw new Error('demo.js tag not found in public/index.html');
fs.writeFileSync(demo, html.replace('<script src="demo.js">', '<script>window.CCW_STATIC = true</script>\n<script src="demo.js">'));

const media = path.join(OUT, 'media');
fs.mkdirSync(media, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
const web = path.join(CACHE, 'showcase.mp4'), poster = path.join(CACHE, 'poster.jpg');
if (stale(web, MASTER)) {
  ffmpeg('-i', MASTER, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', web);
}
if (stale(poster, MASTER)) ffmpeg('-ss', '21.6', '-i', MASTER, '-frames:v', '1', '-q:v', '3', poster); // the Code Gods moment
fs.copyFileSync(web, path.join(media, 'showcase.mp4'));
fs.copyFileSync(poster, path.join(media, 'poster.jpg'));
ffmpeg('-i', poster, '-vf', 'scale=1280:-2', '-c:v', 'libwebp', '-quality', '78', path.join(media, 'poster.webp')); // on the page; the jpg is for link previews
ffmpeg('-i', path.join(ROOT, 'guide', '03-panels.png'), '-c:v', 'libwebp', '-quality', '82', path.join(media, 'panels.webp'));
ffmpeg('-i', path.join(ROOT, 'guide', '04-phone.png'), '-vf', 'scale=600:-2', '-c:v', 'libwebp', '-quality', '82', path.join(media, 'phone.webp'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Site: ${path.relative(ROOT, OUT)}`);
