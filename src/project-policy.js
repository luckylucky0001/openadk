import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  assertInside,
  assertNoSymlinkWithin,
  fail,
  hashText,
  pathExists,
  readBoundedJson,
  withRecoverableLock,
  writeJsonAtomic
} from "./runtime.js";

const POLICY_PATH = ".openadk/protected-files.json";
const POLICY_LOCK = ".openadk/project-policy.lock";

function policyIntegrity(policy) {
  const { integrity: _integrity, ...body } = policy;
  return hashText(JSON.stringify(body));
}

function portablePath(projectDir, value) {
  if (!value || isAbsolute(value)) fail("E_PROTECTED_PATH_INVALID", `Protected paths must be project-relative: ${value}`);
  const target = assertInside(projectDir, resolve(projectDir, value));
  const portable = relative(projectDir, target).split(sep).join("/");
  if (!portable || portable.startsWith(".openadk/") || portable === ".openadk") {
    fail("E_PROTECTED_PATH_INVALID", `Cannot protect OpenADK-managed state: ${value}`);
  }
  return { portable, target };
}

async function readPolicy(projectDir) {
  const target = resolve(projectDir, POLICY_PATH);
  if (!await pathExists(target)) {
    const empty = { schemaVersion: 2, files: [] };
    return { ...empty, integrity: policyIntegrity(empty) };
  }
  await assertNoSymlinkWithin(projectDir, target);
  const policy = await readBoundedJson(target);
  if (!policy || policy.schemaVersion !== 2 || !Array.isArray(policy.files)
    || policy.integrity !== policyIntegrity(policy)) {
    fail("E_PROJECT_POLICY_INVALID", "Invalid protected-file policy.");
  }
  return policy;
}

export async function protectProjectFiles(projectDir, paths) {
  if (paths.length === 0) fail("E_PROTECTED_PATH_REQUIRED", "Provide at least one project-relative file path.");
  return withRecoverableLock(projectDir, resolve(projectDir, POLICY_LOCK), async () => {
    const policy = await readPolicy(projectDir);
    const records = new Map(policy.files.map((record) => [record.path, record]));
    for (const value of paths) {
      const { portable, target } = portablePath(projectDir, value);
      await assertNoSymlinkWithin(projectDir, target);
      let info;
      try {
        info = await lstat(target);
      } catch (error) {
        if (error.code === "ENOENT") fail("E_PROTECTED_FILE_MISSING", `Protected file does not exist: ${portable}`);
        throw error;
      }
      if (!info.isFile()) fail("E_PROTECTED_FILE_INVALID", `Protected path must be a regular file: ${portable}`);
      const integrity = hashText(await readFile(target));
      const existing = records.get(portable);
      if (existing && existing.integrity !== integrity) {
        fail("E_PROTECTED_FILE_CHANGED", `Refusing to re-baseline modified protected file: ${portable}`);
      }
      records.set(portable, { path: portable, integrity });
    }
    const body = { schemaVersion: 2, files: [...records.values()].sort((a, b) => a.path.localeCompare(b.path)) };
    const next = { ...body, integrity: policyIntegrity(body) };
    await writeJsonAtomic(projectDir, resolve(projectDir, POLICY_PATH), next);
    return next;
  });
}

export async function inspectProtectedFiles(projectDir) {
  const policy = await readPolicy(projectDir);
  const reasons = [];
  for (const record of policy.files) {
    if (!record || typeof record.path !== "string" || typeof record.integrity !== "string") {
      reasons.push("Protected-file policy contains an invalid record.");
      continue;
    }
    try {
      const { portable, target } = portablePath(projectDir, record.path);
      await assertNoSymlinkWithin(projectDir, target);
      if (!await pathExists(target)) reasons.push(`Protected file is missing: ${portable}`);
      else if (hashText(await readFile(target)) !== record.integrity) reasons.push(`Protected file was modified: ${portable}`);
    } catch (error) {
      reasons.push(error.message);
    }
  }
  return { ok: reasons.length === 0, files: policy.files, reasons, integrity: policy.integrity };
}
