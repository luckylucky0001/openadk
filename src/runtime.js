import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 16 * 1024;

export class OpenAdkError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "OpenAdkError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new OpenAdkError(code, message);
}

export function hashText(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function assertInside(root, target, code = "E_PATH_FORBIDDEN") {
  const base = resolve(root);
  const candidate = resolve(target);
  const rel = relative(base, candidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return candidate;
  fail(code, `Path must stay inside ${base}: ${candidate}`);
}

export async function assertNoSymlinkWithin(root, target) {
  const base = resolve(root);
  const candidate = assertInside(base, target, "E_PATH_FORBIDDEN");
  const rel = relative(base, candidate);
  let current = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail("E_PATH_SYMLINK", `Managed path cannot contain a symbolic link: ${current}`);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

export async function readBoundedJson(file, maxBytes = MAX_JSON_BYTES) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) fail("E_JSON_FILE_INVALID", `Expected a regular JSON file: ${file}`);
  if (info.size > maxBytes) fail("E_JSON_TOO_LARGE", `JSON file exceeds ${maxBytes} bytes: ${file}`);
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail("E_JSON_INVALID", `Invalid JSON in ${file}: ${error.message}`);
  }
  return value;
}

export async function writeTextAtomic(root, file, content) {
  await assertNoSymlinkWithin(root, dirname(file));
  await assertNoSymlinkWithin(root, file);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writeJsonAtomic(root, file, value) {
  await writeTextAtomic(root, file, `${JSON.stringify(value, null, 2)}\n`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function validLockOwner(value) {
  return value && value.schemaVersion === 1 && Number.isInteger(value.pid) && value.pid > 0
    && typeof value.hostname === "string" && typeof value.token === "string"
    && /^[0-9a-f-]{36}$/i.test(value.token) && typeof value.createdAt === "string";
}

async function reclaimDeadLock(root, lockPath) {
  await assertNoSymlinkWithin(root, lockPath);
  const first = await lstat(lockPath);
  if (!first.isFile() || first.isSymbolicLink() || first.size > MAX_LOCK_BYTES) {
    fail("E_LOCK_INVALID", `Lock is not a bounded regular file: ${lockPath}`);
  }
  const owner = await readBoundedJson(lockPath, MAX_LOCK_BYTES);
  if (!validLockOwner(owner)) fail("E_LOCK_INVALID", `Lock owner is invalid: ${lockPath}`);
  if (owner.hostname !== hostname() || processIsAlive(owner.pid)) {
    fail("E_LOCKED", `Another OpenADK process owns ${lockPath} (pid ${owner.pid} on ${owner.hostname}).`);
  }
  const second = await lstat(lockPath);
  if (first.dev !== second.dev || first.ino !== second.ino || first.size !== second.size) {
    fail("E_LOCK_CHANGED", `Lock changed while it was being inspected: ${lockPath}`);
  }
  await unlink(lockPath);
}

export async function withRecoverableLock(root, lockPath, operation) {
  await assertNoSymlinkWithin(root, lockPath);
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const owner = {
    schemaVersion: 1,
    pid: process.pid,
    hostname: hostname(),
    token: randomUUID(),
    createdAt: new Date().toISOString()
  };
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(owner)}\n`);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (attempt === 1) fail("E_LOCKED", `Another OpenADK process acquired the lock: ${lockPath}`);
      await reclaimDeadLock(root, lockPath);
    }
  }
  if (!handle) fail("E_LOCKED", `Unable to acquire lock: ${lockPath}`);
  try {
    return await operation(owner);
  } finally {
    await handle.close();
    try {
      const current = await readBoundedJson(lockPath, MAX_LOCK_BYTES);
      if (current.token === owner.token) await unlink(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
