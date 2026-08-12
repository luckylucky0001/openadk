import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertNoSymlinkWithin,
  fail,
  hashText,
  pathExists,
  readBoundedJson,
  withRecoverableLock,
  writeJsonAtomic,
  writeTextAtomic
} from "./runtime.js";
import { inspectProtectedFiles } from "./project-policy.js";

export const METHOD_VERSION = "1.1.0";

const ORCHESTRATOR_BODY = `# OpenADK Orchestrator

Use OpenADK's local state engine for deterministic Spec changes. Never edit \`spec-state.json\`, \`specs/current.json\`, receipts, snapshots, ownership records, or project pins directly.

## Exact command contract

1. Read \`openadk spec status\` and the active Spec artifacts before acting.
2. Create exactly one Spec with \`openadk spec init "<clear title>" --id <spec-id>\`. A Spec ID is accepted only through \`--id\`; never pass it positionally and never invent actions.
3. Use only these Spec actions: \`init\`, \`status\`, \`check\`, \`advance\`, \`export\`, and \`recover --yes\`.
4. Run \`openadk spec check\`; only run \`openadk spec advance\` when the reported next gate passes.
5. Move only through adjacent phases: draft -> specified -> planned -> tasked -> implementing -> verified -> archived.

## Canonical artifacts

- Requirements must use one line per ID: \`- FR-001: ...\` and \`- [ ] AC-001: ...\`. Do not encode FR or AC definitions in Markdown tables.
- Decisions use \`## D-001: ...\` with resolved Status, Context, Decision, and Consequences fields.
- Tasks use \`- [ ] T-001: ... (FR-001, AC-001)\`; check a task only after its implementation and verification work actually succeeds.
- Verification uses \`- V-001: ... (AC-001)\` and records exact receipt IDs and residual risks. Never copy guessed test counts into evidence.

## Verification and safety

1. If the user names immutable project files, protect them before implementation with \`openadk project protect <path...>\`.
2. During \`implementing\`, run real commands through OpenADK, without shell syntax:
   - \`openadk verify run --kind test --covers AC-001,AC-002 -- npm test\`
   - \`openadk verify run --kind adversarial --covers AC-001,AC-002 -- node path/to/adversarial-test.js\`
3. A normal suite and a separate adversarial command must both pass, and successful receipts must cover every AC.
4. Derive adversarial cases from boundaries in requirements and design. For parsers, streams, security filters, storage, retries, limits, or concurrency, test both sides of thresholds and failure points. A chunk test that buffers the whole input is insufficient: force output to begin, split every supported pattern across the real emission boundary, and audit the complete large output for leaks.
5. After receipts pass, update \`verification.md\`, run \`openadk spec check\`, advance to verified, run \`openadk spec export\`, then advance to archived.
6. Never infer completion from activity or Markdown claims. A failed command remains failed; fix the issue and create a new passing receipt.
7. Do not perform Git remote, publishing, sync, update, or destructive actions unless the user explicitly asks.
`;

const SKILL = `---
name: openadk-orchestrator
description: Use when a user asks to create, continue, plan, implement, verify, or archive an OpenADK Spec in this project.
metadata:
  openadk-method-version: "${METHOD_VERSION}"
---

${ORCHESTRATOR_BODY}`;

const CURSOR_RULE = `---
description: OpenADK Spec orchestration and safety boundaries
alwaysApply: true
---

${ORCHESTRATOR_BODY}`;

const MANAGED_ASSETS = Object.freeze({
  ".agents/skills/openadk-orchestrator/SKILL.md": SKILL,
  ".claude/skills/openadk-orchestrator/SKILL.md": SKILL,
  ".claude/rules/openadk-orchestrator.md": ORCHESTRATOR_BODY,
  ".cursor/skills/openadk-orchestrator/SKILL.md": SKILL,
  ".cursor/rules/openadk-orchestrator.mdc": CURSOR_RULE,
  ".opencode/skills/openadk-orchestrator/SKILL.md": SKILL
});

const MANIFEST_PATH = ".openadk/project-assets.json";
const PIN_PATH = ".openadk/project-pin.json";
const LOCK_PATH = ".openadk/project-assets.lock";
const JOURNAL_PATH = ".openadk/project-assets.transaction.json";

function portableFiles() {
  return Object.entries(MANAGED_ASSETS).map(([path, content]) => ({ path, integrity: hashText(content) }));
}

async function projectHasContent(projectDir) {
  const entries = await readdir(projectDir);
  return entries.some((entry) => entry !== ".git" && entry !== ".DS_Store");
}

async function readPin(projectDir) {
  const file = resolve(projectDir, PIN_PATH);
  if (!await pathExists(file)) return null;
  await assertNoSymlinkWithin(projectDir, file);
  const pin = await readBoundedJson(file);
  if (!pin || pin.schemaVersion !== 1 || typeof pin.methodVersion !== "string" || !Array.isArray(pin.files)) {
    fail("E_PROJECT_PIN_INVALID", `Invalid OpenADK project pin: ${file}`);
  }
  return pin;
}

async function managedDrift(projectDir, pin) {
  const reasons = [];
  for (const record of pin.files) {
    if (!record || typeof record.path !== "string" || typeof record.integrity !== "string") {
      reasons.push("Project pin contains an invalid asset record.");
      continue;
    }
    const target = resolve(projectDir, record.path);
    try {
      await assertNoSymlinkWithin(projectDir, target);
      if (!await pathExists(target)) {
        reasons.push(`Managed asset is missing: ${record.path}`);
      } else if (hashText(await readFile(target, "utf8")) !== record.integrity) {
        reasons.push(`Managed asset was modified: ${record.path}`);
      }
    } catch (error) {
      reasons.push(error.message);
    }
  }
  return reasons;
}

async function adoptionConflicts(projectDir) {
  const conflicts = [];
  for (const [portable, content] of Object.entries(MANAGED_ASSETS)) {
    const target = resolve(projectDir, portable);
    await assertNoSymlinkWithin(projectDir, target);
    if (await pathExists(target) && await readFile(target, "utf8") !== content) conflicts.push(portable);
  }
  return conflicts;
}

export async function inspectProject(projectDir) {
  const resolved = resolve(projectDir);
  if (await pathExists(resolve(resolved, JOURNAL_PATH))) {
    return { state: "recovery-required", methodVersion: null, conflicts: [], reasons: ["A project asset transaction must be recovered before Agent work continues."] };
  }
  const pin = await readPin(resolved);
  if (!pin) {
    const conflicts = await adoptionConflicts(resolved);
    if (conflicts.length > 0) {
      return { state: "blocked", methodVersion: null, conflicts, reasons: conflicts.map((path) => `Unmanaged asset conflicts with OpenADK: ${path}`) };
    }
    return {
      state: await projectHasContent(resolved) ? "adoption-required" : "new-project",
      methodVersion: null,
      conflicts: [],
      reasons: []
    };
  }
  const reasons = await managedDrift(resolved, pin);
  const protection = await inspectProtectedFiles(resolved);
  reasons.push(...protection.reasons);
  if (reasons.length > 0) return { state: "blocked", methodVersion: pin.methodVersion, conflicts: [], reasons };
  return {
    state: pin.methodVersion === METHOD_VERSION ? "healthy" : "upgrade-available",
    methodVersion: pin.methodVersion,
    targetVersion: METHOD_VERSION,
    conflicts: [],
    reasons: []
  };
}

async function commitManagedAssets(projectDir) {
  const files = portableFiles();
  for (const record of files) {
    await writeTextAtomic(projectDir, resolve(projectDir, record.path), MANAGED_ASSETS[record.path]);
  }
  const now = new Date().toISOString();
  await writeJsonAtomic(projectDir, resolve(projectDir, MANIFEST_PATH), {
    schemaVersion: 1,
    methodVersion: METHOD_VERSION,
    generatedAt: now,
    files
  });
  await writeJsonAtomic(projectDir, resolve(projectDir, PIN_PATH), {
    schemaVersion: 1,
    methodVersion: METHOD_VERSION,
    adoptedAt: now,
    files
  });
}

async function currentManagedFiles(projectDir) {
  const records = [];
  for (const portable of Object.keys(MANAGED_ASSETS)) {
    const target = resolve(projectDir, portable);
    await assertNoSymlinkWithin(projectDir, target);
    records.push({ path: portable, integrity: await pathExists(target) ? hashText(await readFile(target, "utf8")) : null });
  }
  return records;
}

async function writeManagedAssets(projectDir) {
  const journal = {
    schemaVersion: 1,
    targetVersion: METHOD_VERSION,
    createdAt: new Date().toISOString(),
    before: await currentManagedFiles(projectDir),
    target: portableFiles()
  };
  await writeJsonAtomic(projectDir, resolve(projectDir, JOURNAL_PATH), journal);
  await commitManagedAssets(projectDir);
  await rm(resolve(projectDir, JOURNAL_PATH));
}

export async function recoverProjectAssets(projectDir) {
  const resolved = resolve(projectDir);
  const journalPath = resolve(resolved, JOURNAL_PATH);
  if (!await pathExists(journalPath)) return inspectProject(resolved);
  return withRecoverableLock(resolved, resolve(resolved, LOCK_PATH), async () => {
    await assertNoSymlinkWithin(resolved, journalPath);
    const journal = await readBoundedJson(journalPath);
    const expectedTarget = portableFiles();
    if (!journal || journal.schemaVersion !== 1 || journal.targetVersion !== METHOD_VERSION
      || JSON.stringify(journal.target) !== JSON.stringify(expectedTarget) || !Array.isArray(journal.before)) {
      fail("E_PROJECT_RECOVERY_INVALID", "Project asset transaction does not match this OpenADK method version.");
    }
    const before = new Map(journal.before.map((record) => [record.path, record.integrity]));
    const target = new Map(journal.target.map((record) => [record.path, record.integrity]));
    for (const record of await currentManagedFiles(resolved)) {
      if (record.integrity !== before.get(record.path) && record.integrity !== target.get(record.path)) {
        fail("E_PROJECT_RECOVERY_CONFLICT", `Managed asset changed outside the interrupted transaction: ${record.path}`);
      }
    }
    await commitManagedAssets(resolved);
    await rm(journalPath);
    return inspectProject(resolved);
  });
}

export async function adoptProject(projectDir, { confirmed = false } = {}) {
  const resolved = resolve(projectDir);
  const inspection = await inspectProject(resolved);
  if (inspection.state === "blocked") fail("E_PROJECT_BLOCKED", inspection.reasons.join(" "));
  if (inspection.state === "recovery-required") return recoverProjectAssets(resolved);
  if (inspection.state === "adoption-required" && !confirmed) {
    fail("E_PROJECT_CONFIRM_REQUIRED", `Existing project onboarding requires confirmation: ${resolved}`);
  }
  if (inspection.state === "healthy" || inspection.state === "upgrade-available") return inspection;
  await withRecoverableLock(resolved, resolve(resolved, LOCK_PATH), () => writeManagedAssets(resolved));
  return inspectProject(resolved);
}

export async function applyProjectUpgrade(projectDir, { confirmed = false } = {}) {
  const resolved = resolve(projectDir);
  if (!confirmed) fail("E_PROJECT_UPGRADE_CONFIRM_REQUIRED", "Project method upgrade requires --yes.");
  const inspection = await inspectProject(resolved);
  if (inspection.state === "blocked") fail("E_PROJECT_BLOCKED", inspection.reasons.join(" "));
  if (inspection.state === "recovery-required") return recoverProjectAssets(resolved);
  if (inspection.state === "new-project" || inspection.state === "adoption-required") {
    fail("E_PROJECT_NOT_ADOPTED", "Adopt the project with openadk start before upgrading.");
  }
  if (inspection.state === "healthy") return inspection;
  await withRecoverableLock(resolved, resolve(resolved, LOCK_PATH), () => writeManagedAssets(resolved));
  return inspectProject(resolved);
}

export function managedAssetPaths() {
  return Object.keys(MANAGED_ASSETS);
}
