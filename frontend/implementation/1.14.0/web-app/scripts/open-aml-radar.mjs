import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const windows = process.platform === 'win32';
const port = 5215;
const appPath = 'frontend/implementation/1.14.0/web-app';

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: windows && command === 'pnpm',
  });
  if (result.error || result.status !== 0) {
    throw new Error(command + ' 실행에 실패했습니다. ' + (result.error?.message ?? '위 출력을 확인해 주세요.'));
  }
  return result.stdout?.trim();
}

async function checkPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch(error => {
    if (error.code === 'EADDRINUSE') throw new Error('5215 포트가 사용 중입니다. 기존 프리뷰를 종료한 뒤 다시 열어 주세요.');
    throw error;
  });
  await new Promise(resolve => server.close(resolve));
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12 이상을 설치해 주세요.');
  const version = run('pnpm', ['--version'], repo, true);
  if (version !== '11.24.0') throw new Error('팀 검수에 사용하는 pnpm 11.24.0을 설치해 주세요.');
  await checkPort();

  const current = run('git', ['branch', '--show-current'], repo, true);
  const branch = current === 'fe/work' ? current : 'frontend';
  const remote = run('git', ['config', '--get', 'remote.origin.url'], repo, true);
  const home = join(homedir(), '.aml-radar', 'preview');
  const checkout = join(home, branch.replace('/', '-'));
  mkdirSync(home, { recursive: true });
  const headFile = join(checkout, '.git', 'aml-preview-sha');
  if (!existsSync(checkout)) {
    run('git', ['clone', '--single-branch', '--branch', branch, '--', remote, checkout], repo);
    writeFileSync(headFile, run('git', ['rev-parse', 'HEAD'], checkout, true) + '\n');
  }
  if (!existsSync(headFile) || run('git', ['config', '--get', 'remote.origin.url'], checkout, true) !== remote) {
    throw new Error('검수용 폴더를 확인해 주세요. ' + checkout);
  }
  const previous = readFileSync(headFile, 'utf8').trim();
  const target = 'refs/remotes/origin/' + branch;
  if (run('git', ['rev-parse', 'HEAD'], checkout, true) !== previous ||
      run('git', ['status', '--porcelain'], checkout, true)) {
    throw new Error('검수용 폴더에 변경이 있습니다. 작업을 보존한 후 다시 열어 주세요. ' + checkout);
  }
  run('git', ['fetch', 'origin', 'refs/heads/' + branch + ':' + target], checkout);
  const revision = run('git', ['rev-parse', target], checkout, true);
  run('git', ['merge-base', '--is-ancestor', previous, revision], checkout);
  run('git', ['switch', '--detach', revision], checkout);
  writeFileSync(headFile, revision + '\n');

  const app = join(checkout, appPath);
  const lock = createHash('sha256').update(readFileSync(join(app, 'pnpm-lock.yaml'))).digest('hex');
  const installed = join(checkout, '.git', 'aml-preview-lock');
  const vite = join(app, 'node_modules', '.bin', windows ? 'vite.cmd' : 'vite');
  if (!existsSync(vite) || !existsSync(installed) || readFileSync(installed, 'utf8') !== lock) {
    run('pnpm', ['install', '--frozen-lockfile'], app);
    writeFileSync(installed, lock);
  }

  process.stdout.write('AML RADAR 검수 · ' + branch + ' ' + revision.slice(0, 8) + '\n');
  run('pnpm', ['exec', 'vite', 'live-layout', '--config', 'live-layout/vite.config.mjs', '--open', '/dashboard/mine?data=sample'], app);
}

try {
  await main();
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
