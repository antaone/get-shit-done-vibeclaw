'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execGit } = require('../shell-command-projection.cjs');
const { parseYaml, stringifyYaml } = require('./yaml.cjs');
const { VibeError, invariant } = require('./errors.cjs');

const STATE_DIR = '.planning-vibe';
const STORE_DIRS = ['routes', 'workflows', 'runs', 'candidates', 'promotions', 'history', 'locks', 'state'];
const heldLocks = new Set();

process.on('exit', () => {
  for (const lockPath of heldLocks) {
    try { fs.unlinkSync(lockPath); } catch { /* already released */ }
  }
});

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseWorktreePaths(porcelain) {
  return String(porcelain || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function findStateRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  const filesystemRoot = path.parse(current).root;
  while (true) {
    if (fs.existsSync(path.join(current, STATE_DIR))) return current;
    if (current === filesystemRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const listed = execGit(['worktree', 'list', '--porcelain'], { cwd: startDir, timeout: 5000 });
  if (listed.exitCode === 0) {
    for (const worktreePath of parseWorktreePaths(listed.stdout)) {
      if (fs.existsSync(path.join(worktreePath, STATE_DIR))) return path.resolve(worktreePath);
    }
  }
  throw new VibeError('NOT_INITIALIZED', `No ${STATE_DIR} directory found from ${path.resolve(startDir || process.cwd())}`, {
    hint: 'Run vibe init in the project root.',
  });
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
    throw error;
  }
}

function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new VibeError('STATE_NOT_FOUND', `${label} does not exist`, { path: filePath });
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new VibeError('STATE_CORRUPT', `${label} contains invalid JSON`, { path: filePath, cause: error.message });
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

class VibeStore {
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.root = path.join(this.projectRoot, STATE_DIR);
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10000;
    this.staleLockMs = options.staleLockMs ?? 30000;
    this.now = options.now || (() => Date.now());
  }

  static discover(startDir, options) {
    return new VibeStore(findStateRoot(startDir), options);
  }

  get paths() {
    return {
      root: this.root,
      config: path.join(this.root, 'config.yaml'),
      routes: path.join(this.root, 'routes'),
      workflows: path.join(this.root, 'workflows'),
      runs: path.join(this.root, 'runs'),
      candidates: path.join(this.root, 'candidates'),
      promotions: path.join(this.root, 'promotions'),
      history: path.join(this.root, 'history', 'events.jsonl'),
      locks: path.join(this.root, 'locks'),
      activeRun: path.join(this.root, 'state', 'active-run.json'),
    };
  }

  initialize() {
    fs.mkdirSync(this.root, { recursive: true });
    for (const dir of STORE_DIRS) fs.mkdirSync(path.join(this.root, dir), { recursive: true });
  }

  exists() {
    return fs.existsSync(this.root);
  }

  readJson(filePath, label = 'State file') {
    return readJsonFile(filePath, label);
  }

  writeJson(filePath, value) {
    atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  readYaml(filePath, label = 'Configuration file') {
    let raw;
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') throw new VibeError('STATE_NOT_FOUND', `${label} does not exist`, { path: filePath });
      throw error;
    }
    return parseYaml(raw, filePath);
  }

  writeYaml(filePath, value) {
    atomicWrite(filePath, stringifyYaml(value));
  }

  runPath(runId) {
    return path.join(this.paths.runs, runId, 'run.json');
  }

  candidateDir(candidateId) {
    return path.join(this.paths.candidates, candidateId);
  }

  candidatePath(candidateId) {
    return path.join(this.candidateDir(candidateId), 'manifest.json');
  }

  contextPath(candidateId, format = 'json') {
    return path.join(this.candidateDir(candidateId), `context.${format === 'markdown' ? 'md' : 'json'}`);
  }

  loadRun(runId) {
    return this.readJson(this.runPath(runId), `Run '${runId}'`);
  }

  saveRun(run) {
    this.writeJson(this.runPath(run.id), run);
  }

  loadCandidate(candidateId) {
    return this.readJson(this.candidatePath(candidateId), `Candidate '${candidateId}'`);
  }

  saveCandidate(candidate) {
    fs.mkdirSync(this.candidateDir(candidate.id), { recursive: true });
    this.writeJson(this.candidatePath(candidate.id), candidate);
  }

  listRunIds() {
    if (!fs.existsSync(this.paths.runs)) return [];
    return fs.readdirSync(this.paths.runs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(this.paths.runs, entry.name, 'run.json')))
      .map((entry) => entry.name)
      .sort();
  }

  listCandidateIds() {
    if (!fs.existsSync(this.paths.candidates)) return [];
    return fs.readdirSync(this.paths.candidates, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(this.paths.candidates, entry.name, 'manifest.json')))
      .map((entry) => entry.name)
      .sort();
  }

  loadActiveRunId() {
    if (!fs.existsSync(this.paths.activeRun)) return null;
    const state = this.readJson(this.paths.activeRun, 'Active run state');
    return typeof state.run_id === 'string' ? state.run_id : null;
  }

  setActiveRun(runId) {
    this.writeJson(this.paths.activeRun, { schema_version: 1, run_id: runId, updated_at: new Date(this.now()).toISOString() });
  }

  promotionDir(runId, stage) {
    return path.join(this.paths.promotions, runId, stage);
  }

  loadCurrentPromotion(runId, stage) {
    const current = path.join(this.promotionDir(runId, stage), 'current.json');
    if (!fs.existsSync(current)) return null;
    return this.readJson(current, `Current promotion for ${runId}/${stage}`);
  }

  savePromotion(promotion) {
    const dir = this.promotionDir(promotion.run_id, promotion.stage);
    fs.mkdirSync(dir, { recursive: true });
    const numbers = fs.readdirSync(dir)
      .map((name) => name.match(/^(\d{4})\.json$/))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
    const record = { ...promotion, sequence: next };
    this.writeJson(path.join(dir, `${String(next).padStart(4, '0')}.json`), record);
    this.writeJson(path.join(dir, 'current.json'), record);
    return record;
  }

  writePromotionIntent(intent) {
    const dir = this.promotionDir(intent.run_id, intent.stage);
    fs.mkdirSync(dir, { recursive: true });
    this.writeJson(path.join(dir, 'intent.json'), intent);
  }

  clearPromotionIntent(runId, stage) {
    try { fs.unlinkSync(path.join(this.promotionDir(runId, stage), 'intent.json')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  appendEvent(event) {
    fs.mkdirSync(path.dirname(this.paths.history), { recursive: true });
    fs.appendFileSync(this.paths.history, `${JSON.stringify(event)}\n`, 'utf8');
  }

  readEvents() {
    if (!fs.existsSync(this.paths.history)) return [];
    const raw = fs.readFileSync(this.paths.history, 'utf8');
    const events = [];
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch (error) {
        throw new VibeError('STATE_CORRUPT', `History contains invalid JSON at line ${index + 1}`, {
          path: this.paths.history,
          cause: error.message,
        });
      }
    }
    return events;
  }

  withLock(name, fn) {
    invariant(/^[a-z0-9-]+$/.test(name), 'LOCK_INVALID', `Invalid lock name '${name}'`);
    fs.mkdirSync(this.paths.locks, { recursive: true });
    const lockPath = path.join(this.paths.locks, `${name}.lock`);
    const started = this.now();

    while (this.now() - started < this.lockTimeoutMs) {
      try {
        const payload = { pid: process.pid, host: os.hostname(), acquired_at: new Date(this.now()).toISOString() };
        fs.writeFileSync(lockPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', flag: 'wx' });
        heldLocks.add(lockPath);
        try { return fn(); } finally {
          heldLocks.delete(lockPath);
          try { fs.unlinkSync(lockPath); } catch { /* already released */ }
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let stale = false;
        try {
          const stat = fs.statSync(lockPath);
          const age = this.now() - stat.mtimeMs;
          const owner = readJsonFile(lockPath, `Lock '${name}'`);
          const sameHost = owner.host === os.hostname();
          const ownerAlive = sameHost && processIsAlive(Number(owner.pid));
          // A live local process keeps its lock regardless of age. For a lock
          // created on another host (for example a shared checkout), age is the
          // only safe recovery signal available.
          stale = sameHost ? !ownerAlive : age > this.staleLockMs;
        } catch (readError) {
          stale = readError.code === 'ENOENT';
        }
        if (stale) {
          try { fs.unlinkSync(lockPath); } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') throw unlinkError;
          }
          continue;
        }
        sleepSync(50);
      }
    }
    throw new VibeError('LOCK_TIMEOUT', `Timed out waiting for orchestration lock '${name}'`, { path: lockPath });
  }
}

module.exports = {
  STATE_DIR,
  STORE_DIRS,
  VibeStore,
  findStateRoot,
  atomicWrite,
  parseWorktreePaths,
};
