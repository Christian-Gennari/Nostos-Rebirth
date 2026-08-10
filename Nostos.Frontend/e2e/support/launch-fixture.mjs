#!/usr/bin/env node
/**
 * Task 13 Playwright fixture launcher.
 *
 * Owns a fully isolated Nostos instance for cross-surface E2E:
 *   - a fresh temp directory (temp DB via --contentRoot, temp wwwroot with a
 *     freshly built Angular app, backend logs);
 *   - the real ASP.NET Core backend (Debug build of Nostos.Backend.dll) on a
 *     random free 127.0.0.1 port, with MCP Streamable HTTP explicitly enabled
 *     and authenticated with a per-run random bearer token (the product
 *     default keeps MCP disabled; this fixture opts in deliberately);
 *   - deterministic lifecycle: `launch` (build + start + wait healthy),
 *     `restart` (same DB/wwwroot/token, new process — persistence check),
 *     `kill` (terminate + clean up temp dir, keep backend.log evidence).
 *     The backend is spawned DETACHED with stdout/stderr redirected into
 *     backend.log via file descriptors, so the launch CLI exits as soon as
 *     the health check passes while the backend keeps running; pid-based
 *     restart/kill still work. `E2E_SKIP_BUILDS=1` reuses existing build
 *     artifacts (verified to exist) for deterministic lifecycle checks.
 *
 * State is written to e2e/support/fixture-state.json (owner-only, mode
 * 0600 — it retains the MCP bearer token) so specs, global setup/teardown,
 * and the restart path all agree on the same instance. The token is never
 * printed by this launcher.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import net from 'node:net';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.resolve(HERE, '..');
const FRONTEND_DIR = path.resolve(E2E_DIR, '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'Nostos.Backend');
const STATE_FILE = path.join(HERE, 'fixture-state.json');

const DLL = path.join(BACKEND_DIR, 'bin', 'Debug', 'net10.0', 'Nostos.Backend.dll');
const DIST_BROWSER = path.join(FRONTEND_DIR, 'dist', 'Nostos.Frontend', 'browser');

const HEALTH_TIMEOUT_MS = 240_000;

function log(...args) {
  console.log('[fixture]', ...args);
}

function readState() {
  if (!existsSync(STATE_FILE)) throw new Error(`Fixture state missing (${STATE_FILE}); run launch first.`);
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

// The handoff file retains the MCP bearer token: owner-only permissions.
function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealthy(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/books?pageSize=1`);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Backend at ${baseUrl} not healthy within ${timeoutMs}ms (${lastErr})`);
}

async function waitForPortFree(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (free) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Port ${port} did not free within ${timeoutMs}ms`);
}

function buildBackend() {
  log('building backend (dotnet build -c Debug)...');
  const r = spawnSync(
    'dotnet',
    ['build', path.join(BACKEND_DIR, 'Nostos.Backend.csproj'), '-c', 'Debug', '--nologo', '-v', 'q'],
    { stdio: 'inherit', timeout: 600_000 }
  );
  if (r.status !== 0) throw new Error(`dotnet build failed (exit ${r.status})`);
  if (!existsSync(DLL)) throw new Error(`Backend DLL not found: ${DLL}`);

  // Fresh-DB bootstrap helper (schema from the EF model + migration history
  // marked applied; the backend's startup Migrate() no-ops on it).
  const bootstrapProj = path.join(E2E_DIR, 'support', 'db-bootstrap', 'DbBootstrap.csproj');
  const r2 = spawnSync(
    'dotnet',
    ['build', bootstrapProj, '-c', 'Debug', '--nologo', '-v', 'q'],
    { stdio: 'inherit', timeout: 600_000 }
  );
  if (r2.status !== 0) throw new Error(`db-bootstrap build failed (exit ${r2.status})`);
}

const BOOTSTRAP_DLL = path.join(
  E2E_DIR,
  'support',
  'db-bootstrap',
  'bin',
  'Debug',
  'net10.0',
  'Nostos.E2eDbBootstrap.dll'
);

function bootstrapDb(tempDir) {
  log('bootstrapping fresh temp DB (EnsureCreated + migration history)...');
  const r = spawnSync('dotnet', [BOOTSTRAP_DLL, path.join(tempDir, 'nostos.db')], {
    stdio: 'inherit',
    timeout: 300_000,
  });
  if (r.status !== 0) throw new Error(`db-bootstrap failed (exit ${r.status})`);
}

function buildFrontend() {
  log('building Angular frontend (ng build)...');
  const r = spawnSync('npm', ['run', 'build'], { cwd: FRONTEND_DIR, stdio: 'inherit', timeout: 600_000 });
  if (r.status !== 0) throw new Error(`npm run build failed (exit ${r.status})`);
  if (!existsSync(path.join(DIST_BROWSER, 'index.html'))) {
    throw new Error(`Angular build output missing index.html at ${DIST_BROWSER}`);
  }
}

/**
 * Spawns the real backend as a DETACHED process. stdout/stderr are redirected
 * straight into backend.log via duplicated file descriptors (no pipes), so
 * nothing keeps the launcher CLI's event loop alive: `launch`/`restart`
 * return as soon as the health check passes and the CLI exits, while the
 * backend keeps running detached. Pid-based restart/kill still work
 * (detached only moves the child into its own process group/session).
 */
function spawnBackend(state) {
  const logFd = openSync(path.join(state.tempDir, 'backend.log'), 'a');
  let child;
  try {
    child = spawn(
      'dotnet',
      [DLL, '--contentRoot', state.tempDir, '--urls', `http://127.0.0.1:${state.port}`],
      {
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: 'Production',
          Mcp__Enabled: 'true',
          Mcp__Path: '/mcp',
          Mcp__ApiKeyEnvironmentVariable: 'NOSTOS_MCP_TOKEN',
          NOSTOS_MCP_TOKEN: state.token,
          DOTNET_NOLOGO: '1',
        },
        stdio: ['ignore', logFd, logFd],
        detached: true,
      }
    );
  } finally {
    // The child holds its own duplicated descriptors; the parent copy is
    // closed so no handle on this side stays open.
    closeSync(logFd);
  }
  // The backend must outlive this CLI: unref the child handle so neither it
  // nor any pipe keeps the launcher process from exiting after it resolves.
  child.unref();
  child.on('exit', (code, signal) => {
    log(`backend process exited code=${code} signal=${signal}`);
  });
  child.on('error', (err) => log(`backend spawn error: ${err.message}`));
  return child;
}

export async function launch() {
  if (process.env.E2E_SKIP_BUILDS === '1') {
    // Deterministic lifecycle check: reuse existing artifacts (verified to
    // exist) so the launch bound measures the lifecycle, not compile time.
    for (const [label, p] of [
      ['backend DLL', DLL],
      ['db-bootstrap DLL', BOOTSTRAP_DLL],
      ['Angular dist index', path.join(DIST_BROWSER, 'index.html')],
    ]) {
      if (!existsSync(p)) {
        throw new Error(`E2E_SKIP_BUILDS=1 but ${label} missing at ${p}`);
      }
    }
    log('E2E_SKIP_BUILDS=1: reusing existing build artifacts');
  } else {
    buildBackend();
    buildFrontend();
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'nostos-e2e-'));
  const wwwroot = path.join(tempDir, 'wwwroot');
  cpSync(DIST_BROWSER, wwwroot, { recursive: true });
  bootstrapDb(tempDir);

  const port = await freePort();
  const state = {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    token: crypto.randomBytes(24).toString('hex'),
    tempDir,
    repoRoot: REPO_ROOT,
    backendPid: null,
    startedAt: new Date().toISOString(),
  };

  log(`starting backend on ${state.baseUrl} (content root ${tempDir})`);
  const child = spawnBackend(state);
  state.backendPid = child.pid;
  writeState(state);

  try {
    await waitForHealthy(state.baseUrl, HEALTH_TIMEOUT_MS);
  } catch (err) {
    child.kill('SIGKILL');
    log(`backend log: ${path.join(tempDir, 'backend.log')}`);
    throw err;
  }

  // Note: never log the MCP token; it is only handed to the backend via env
  // and persisted (owner-only) in fixture-state.json.
  log(`fixture ready: ${state.baseUrl} (pid ${child.pid})`);
  return state;
}

export async function restart() {
  const state = readState();
  log(`restarting backend on ${state.baseUrl} (pid ${state.backendPid}, same DB ${state.tempDir}/nostos.db)`);

  if (state.backendPid) {
    try {
      process.kill(state.backendPid, 'SIGTERM');
    } catch (err) {
      log(`backend pid ${state.backendPid} already gone (${err.message})`);
    }
  }

  await new Promise((r) => setTimeout(r, 1_500));
  await waitForPortFree(state.port);

  const child = spawnBackend(state);
  state.backendPid = child.pid;
  state.startedAt = new Date().toISOString();
  writeState(state);

  try {
    await waitForHealthy(state.baseUrl, HEALTH_TIMEOUT_MS);
  } catch (err) {
    child.kill('SIGKILL');
    log(`backend log: ${path.join(state.tempDir, 'backend.log')}`);
    throw err;
  }
  log(`backend restarted (pid ${child.pid})`);
  return state;
}

export async function killFixture() {
  const state = readState();
  log(`tearing down fixture (pid ${state.backendPid}, temp ${state.tempDir})`);
  if (state.backendPid) {
    try {
      process.kill(state.backendPid, 'SIGTERM');
    } catch (err) {
      log(`backend pid ${state.backendPid} already gone (${err.message})`);
    }
    // Give the process a moment to exit, then force.
    await new Promise((r) => setTimeout(r, 2_000));
    try {
      process.kill(state.backendPid, 'SIGKILL');
    } catch {
      // already exited
    }
  }

  // Keep backend.log as failure evidence next to the Playwright artifacts.
  const evidenceDir = path.join(E2E_DIR, 'test-results');
  const logPath = path.join(state.tempDir, 'backend.log');
  if (existsSync(logPath)) {
    try {
      const dest = path.join(evidenceDir, `backend-${state.port}.log`);
      const { copyFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(evidenceDir, { recursive: true });
      copyFileSync(logPath, dest);
      log(`backend log preserved at ${dest}`);
    } catch (err) {
      log(`could not preserve backend log: ${err.message}`);
    }
  }

  if (process.env.E2E_KEEP_FIXTURE === '1') {
    log(`E2E_KEEP_FIXTURE=1: keeping temp dir ${state.tempDir}`);
  } else {
    rmSync(state.tempDir, { recursive: true, force: true });
  }
  unlinkSync(STATE_FILE);
}

// --- CLI entry ---
const [command = 'launch'] = process.argv.slice(2);
if (command === 'launch') {
  launch().catch((err) => {
    console.error(`[fixture] launch failed: ${err.message}`);
    process.exit(1);
  });
} else if (command === 'restart') {
  restart().catch((err) => {
    console.error(`[fixture] restart failed: ${err.message}`);
    process.exit(1);
  });
} else if (command === 'kill') {
  killFixture().catch((err) => {
    console.error(`[fixture] kill failed: ${err.message}`);
    process.exit(1);
  });
} else {
  console.error(`[fixture] unknown command '${command}' (expected launch|restart|kill)`);
  process.exit(2);
}
