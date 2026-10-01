// Copy the static site into public/thecardwall/ so Workers Static Assets
// serve it under the same /thecardwall/ path it has on moxapp.io.
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.resolve(workerDir, '..');
const publicDir = path.join(workerDir, 'public');
const outDir = path.join(publicDir, 'thecardwall');
const SITE_FILES = ['index.html', 'app.css', 'js', 'assets', 'vendor'];

if (path.basename(publicDir) !== 'public' || !publicDir.startsWith(workerDir)) {
  throw new Error(`Refusing to clean unexpected folder ${publicDir}`);
}
await rm(publicDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
for (const entry of SITE_FILES) {
  await stat(path.join(siteDir, entry)); // fail loudly if something is missing
  await cp(path.join(siteDir, entry), path.join(outDir, entry), {
    recursive: true,
    filter: (source) => !/(^|[\\/])(\.DS_Store|__.*|.*\.map)$/.test(source),
  });
}

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: siteDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // Not a git checkout (e.g. a release zip): use the commit stamped into it.
  try {
    commit = (await readFile(path.join(siteDir, 'RELEASE'), 'utf8')).trim() || commit;
  } catch {
    // no stamp either
  }
}
const build = { built: new Date().toISOString(), commit };
await writeFile(path.join(outDir, 'build.json'), `${JSON.stringify(build, null, 2)}\n`);
console.log(`Built ${path.relative(process.cwd(), outDir) || outDir} (${commit})`);
