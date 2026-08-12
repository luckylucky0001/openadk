import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
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
import { readVerificationReceipts } from "./verification.js";

export const SPEC_PHASES = ["draft", "specified", "planned", "tasked", "implementing", "verified", "archived"];

const ARTIFACTS = ["requirements.md", "design.md", "decisions.md", "tasks.md", "verification.md"];
const TEMPLATES = {
  "requirements.md": `# Requirements: {{TITLE}}

## Problem

TBD

## Goals

- TBD

## Non-goals

- TBD

## Users and Scenarios

- TBD

## Functional Requirements

- FR-001: TBD

## Quality Attributes

- TBD

## Acceptance Criteria

- [ ] AC-001: TBD

## Open Questions

- TBD
`,
  "design.md": `# Design: {{TITLE}}

## Context and Constraints

TBD

## Architecture

TBD

## Interfaces and Data

TBD

## Failure Handling

TBD

## Security and Privacy

TBD

## Verification Strategy

TBD

## Migration and Rollback

TBD
`,
  "decisions.md": `# Decisions: {{TITLE}}

## D-001: TBD

- Status: proposed
- Context: TBD
- Decision: TBD
- Consequences: TBD
`,
  "tasks.md": `# Tasks: {{TITLE}}

- [ ] T-001: TBD (FR-001, AC-001)
`,
  "verification.md": `# Verification: {{TITLE}}

## Evidence

- V-001: TBD (AC-001)

## Commands

- TBD

## Residual Risks

- TBD
`
};

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "spec";
}

function assertSpecId(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) fail("E_SPEC_ID_INVALID", `Invalid spec ID: ${value}`);
  return value;
}

function specPath(projectDir, id) {
  const specsRoot = resolve(projectDir, "specs");
  const target = resolve(specsRoot, assertSpecId(id));
  if (!target.startsWith(`${specsRoot}${sep}`)) fail("E_SPEC_PATH_INVALID", "Spec path must stay inside specs/.");
  return target;
}

function snapshotPath(projectDir, id, revision) {
  return resolve(projectDir, ".openadk", "spec-snapshots", assertSpecId(id), `revision-${revision}.json`);
}

async function snapshotState(projectDir, state) {
  const target = snapshotPath(projectDir, state.id, state.revision);
  if (await pathExists(target)) {
    const existing = await readBoundedJson(target);
    validateState(existing, state.id);
    if (hashText(JSON.stringify(existing)) !== hashText(JSON.stringify(state))) {
      fail("E_SPEC_SNAPSHOT_CONFLICT", `Snapshot already differs for ${state.id} revision ${state.revision}.`);
    }
    return;
  }
  await writeJsonAtomic(projectDir, target, state);
}

async function readJson(file) {
  return readBoundedJson(file);
}

async function currentId(projectDir) {
  const pointer = resolve(projectDir, "specs/current.json");
  await assertNoSymlinkWithin(projectDir, pointer);
  if (!existsSync(pointer)) fail("E_SPEC_CURRENT_MISSING", "No active Spec. Run openadk spec init \"title\".");
  return assertSpecId((await readJson(pointer)).id);
}

async function resolveId(projectDir, requestedId) {
  return requestedId ? assertSpecId(requestedId) : currentId(projectDir);
}

export async function createSpec(projectDir, title, requestedId) {
  if (!title?.trim()) fail("E_SPEC_TITLE_REQUIRED", "A title is required.");
  const id = assertSpecId(requestedId || slugify(title));
  const root = specPath(projectDir, id);
  await assertNoSymlinkWithin(projectDir, resolve(projectDir, "specs"));
  await assertNoSymlinkWithin(projectDir, resolve(projectDir, ".openadk"));
  return withRecoverableLock(projectDir, resolve(projectDir, ".openadk/spec.lock"), async () => {
    if (existsSync(root)) {
      const recovered = await recoverInitializedSpec(projectDir, id, title.trim());
      if (recovered) return recovered;
      fail("E_SPEC_EXISTS", `Spec already exists: ${id}`);
    }
    await mkdir(dirname(root), { recursive: true, mode: 0o700 });
    const temporaryRoot = join(dirname(root), `.${id}.${process.pid}.${Date.now()}.tmp`);
    await mkdir(temporaryRoot, { mode: 0o700 });
    try {
      for (const artifact of ARTIFACTS) {
        await writeTextAtomic(projectDir, join(temporaryRoot, artifact), TEMPLATES[artifact].replaceAll("{{TITLE}}", title.trim()));
      }
      const now = new Date().toISOString();
      const state = {
        schemaVersion: 2,
        id,
        title: title.trim(),
        phase: "draft",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        history: [historyEvent(1, null, "draft", now, {}, null)]
      };
      await writeJsonAtomic(projectDir, join(temporaryRoot, "spec-state.json"), state);
      await rename(temporaryRoot, root);
      await snapshotState(projectDir, state);
      await writeJsonAtomic(projectDir, resolve(projectDir, "specs/current.json"), { schemaVersion: 1, id });
      return state;
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  });
}

async function recoverInitializedSpec(projectDir, id, title) {
  const root = specPath(projectDir, id);
  await assertNoSymlinkWithin(projectDir, root);
  let state;
  try {
    state = await readBoundedJson(join(root, "spec-state.json"));
    validateState(state, id);
  } catch {
    return null;
  }
  if (state.title !== title || state.phase !== "draft" || state.revision !== 1) return null;
  for (const artifact of ARTIFACTS) {
    const file = join(root, artifact);
    await assertNoSymlinkWithin(projectDir, file);
    if (!await pathExists(file)) return null;
  }
  const pointer = resolve(projectDir, "specs/current.json");
  if (await pathExists(pointer)) return null;
  await writeJsonAtomic(projectDir, pointer, { schemaVersion: 1, id });
  return state;
}

export async function readSpec(projectDir, requestedId) {
  const id = await resolveId(projectDir, requestedId);
  const statePath = join(specPath(projectDir, id), "spec-state.json");
  await assertNoSymlinkWithin(projectDir, statePath);
  const state = await readJson(statePath);
  validateState(state, id);
  return state;
}

export async function recoverSpec(projectDir, requestedId) {
  const id = await resolveId(projectDir, requestedId);
  const root = resolve(projectDir, ".openadk", "spec-snapshots", id);
  await assertNoSymlinkWithin(projectDir, root);
  if (!await pathExists(root)) fail("E_SPEC_RECOVERY_UNAVAILABLE", `No trusted snapshots exist for ${id}.`);
  const revisions = (await readdir(root))
    .map((file) => ({ file, revision: Number(file.match(/^revision-(\d+)\.json$/)?.[1]) }))
    .filter((entry) => Number.isInteger(entry.revision))
    .sort((a, b) => b.revision - a.revision);
  for (const entry of revisions) {
    try {
      const state = await readBoundedJson(join(root, entry.file));
      validateState(state, id);
      if (state.revision !== entry.revision) continue;
      await writeJsonAtomic(projectDir, join(specPath(projectDir, id), "spec-state.json"), state);
      return state;
    } catch {
      // Try the previous intact snapshot.
    }
  }
  fail("E_SPEC_RECOVERY_UNAVAILABLE", `No valid trusted snapshot exists for ${id}.`);
}

function historyEvent(revision, from, to, at, evidence, previousDigest) {
  const body = { revision, from, to, at, evidence, previousDigest };
  return { ...body, digest: hashText(JSON.stringify(body)) };
}

function validateState(state, id) {
  if (!state || state.schemaVersion !== 2 || state.id !== id || !SPEC_PHASES.includes(state.phase)
    || !Number.isInteger(state.revision) || state.revision < 1 || !Array.isArray(state.history)
    || state.history.length !== state.revision) {
    fail("E_SPEC_STATE_INVALID", `Invalid state for ${id}.`);
  }
  let previousDigest = null;
  for (let index = 0; index < state.history.length; index += 1) {
    const event = state.history[index];
    const expected = historyEvent(event.revision, event.from, event.to, event.at, event.evidence, previousDigest);
    const expectedFrom = index === 0 ? null : SPEC_PHASES[index - 1];
    const expectedTo = SPEC_PHASES[index];
    if (event.revision !== index + 1 || event.from !== expectedFrom || event.to !== expectedTo
      || event.previousDigest !== previousDigest || event.digest !== expected.digest) {
      fail("E_SPEC_HISTORY_INVALID", `History digest chain is invalid for ${id} at revision ${index + 1}.`);
    }
    previousDigest = event.digest;
  }
  const last = state.history[state.history.length - 1];
  if (last.to !== state.phase || last.revision !== state.revision) fail("E_SPEC_STATE_INVALID", `State does not match history for ${id}.`);
}

function section(content, heading) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n").trim();
}

function substantive(value) {
  const withoutComments = value.replace(/<!--[^]*?-->/g, "");
  const hasPlaceholderLine = /^\s*(?:[-*]\s*)?(?:TBD|TODO)(?:\s*[:.-].*)?\s*$/im.test(withoutComments);
  return withoutComments.replace(/[-*#`\s]/g, "").length >= 8 && !hasPlaceholderLine;
}

async function validateTarget(projectDir, id, target, currentState) {
  const root = specPath(projectDir, id);
  const errors = [];
  const evidence = {};
  const contents = {};
  const need = async (file) => {
    if (contents[file] !== undefined) return contents[file];
    const target = join(root, file);
    await assertNoSymlinkWithin(projectDir, target);
    const content = await readFile(target, "utf8");
    contents[file] = content;
    evidence[file] = hashText(content);
    return content;
  };
  let requirementIds = [];
  let acceptanceIds = [];

  if (SPEC_PHASES.indexOf(target) >= SPEC_PHASES.indexOf("specified")) {
    const requirements = await need("requirements.md");
    for (const heading of ["Problem", "Goals", "Non-goals", "Users and Scenarios", "Functional Requirements", "Quality Attributes"]) {
      if (!substantive(section(requirements, heading))) errors.push(`requirements.md needs substantive ${heading}.`);
    }
    requirementIds = [...requirements.matchAll(/^- (FR-\d{3}):\s*\S.+$/gm)].map((match) => match[1]);
    acceptanceIds = [...requirements.matchAll(/^- \[[ xX]\] (AC-\d{3}):\s*\S.+$/gm)].map((match) => match[1]);
    if (requirementIds.length === 0) errors.push("requirements.md needs at least one FR-### row.");
    if (acceptanceIds.length === 0) errors.push("requirements.md needs at least one AC-### row.");
    if (new Set(requirementIds).size !== requirementIds.length) errors.push("Functional requirement IDs must be unique.");
    if (new Set(acceptanceIds).size !== acceptanceIds.length) errors.push("Acceptance criterion IDs must be unique.");
    if (!/^\s*(?:-|\*)?\s*None\.?\s*$/i.test(section(requirements, "Open Questions"))) errors.push("Open Questions must explicitly say None.");
  }

  if (SPEC_PHASES.indexOf(target) >= SPEC_PHASES.indexOf("planned")) {
    const design = await need("design.md");
    for (const heading of ["Context and Constraints", "Architecture", "Interfaces and Data", "Failure Handling", "Security and Privacy", "Verification Strategy", "Migration and Rollback"]) {
      if (!substantive(section(design, heading))) errors.push(`design.md needs substantive ${heading}.`);
    }
    const decisions = await need("decisions.md");
    const decisionIds = [...decisions.matchAll(/^## (D-\d{3}):\s*\S.+$/gm)].map((match) => match[1]);
    if (decisionIds.length === 0) errors.push("decisions.md needs at least one D-### decision.");
    if (new Set(decisionIds).size !== decisionIds.length) errors.push("Decision IDs must be unique.");
    if (!/^- Status:\s*(?:accepted|rejected|superseded)\s*$/mi.test(decisions)) errors.push("decisions.md needs a resolved decision status.");
    for (const field of ["Context", "Decision", "Consequences"]) {
      if (!new RegExp(`^- ${field}:\\s*(?!TBD|TODO).{8,}$`, "mi").test(decisions)) errors.push(`decisions.md needs a substantive ${field} field.`);
    }
  }

  if (SPEC_PHASES.indexOf(target) >= SPEC_PHASES.indexOf("tasked")) {
    const tasks = await need("tasks.md");
    const taskRows = tasks.split(/\r?\n/).filter((line) => /^- \[[ xX]\] T-\d{3}:/.test(line));
    const taskIds = taskRows.map((line) => line.match(/T-\d{3}/)[0]);
    if (taskRows.length === 0) errors.push("tasks.md needs at least one T-### checkbox.");
    if (new Set(taskIds).size !== taskIds.length) errors.push("Task IDs must be unique.");
    for (const fr of requirementIds) {
      if (!taskRows.some((line) => new RegExp(`\\b${fr}\\b`).test(line))) errors.push(`tasks.md must trace ${fr}.`);
    }
    for (const ac of acceptanceIds) {
      if (!taskRows.some((line) => new RegExp(`\\b${ac}\\b`).test(line))) errors.push(`tasks.md must trace ${ac}.`);
    }
    if (/\b(?:TBD|TODO)\b/i.test(tasks)) errors.push("tasks.md still contains placeholders.");
  }

  if (SPEC_PHASES.indexOf(target) >= SPEC_PHASES.indexOf("verified")) {
    const tasks = await need("tasks.md");
    if (/^- \[ \] T-\d{3}:/m.test(tasks)) errors.push("All T-### tasks must be complete before verification.");
    const verification = await need("verification.md");
    const verificationRows = verification.split(/\r?\n/).filter((line) => /^- V-\d{3}:\s*(?!TBD|TODO).{8,}$/i.test(line));
    const verificationIds = verificationRows.map((line) => line.match(/V-\d{3}/)[0]);
    if (verificationRows.length === 0) errors.push("verification.md needs at least one substantive V-### evidence row.");
    if (new Set(verificationIds).size !== verificationIds.length) errors.push("Verification IDs must be unique.");
    for (const ac of acceptanceIds) {
      if (!verificationRows.some((line) => new RegExp(`\\b${ac}\\b`).test(line))) errors.push(`verification.md must provide evidence for ${ac}.`);
    }
    if (!substantive(section(verification, "Commands"))) errors.push("verification.md needs executed command evidence.");
    const expectedRevision = currentState.phase === "implementing" ? currentState.revision : currentState.revision - 1;
    try {
      const receipts = await readVerificationReceipts(projectDir, id, expectedRevision);
      const passed = receipts.filter(({ receipt }) => receipt.passed);
      if (!passed.some(({ receipt }) => receipt.kind === "test")) errors.push("Verification requires a passing test receipt from openadk verify run.");
      if (!passed.some(({ receipt }) => receipt.kind === "adversarial")) errors.push("Verification requires a separate passing adversarial receipt.");
      for (const ac of acceptanceIds) {
        if (!passed.some(({ receipt }) => receipt.covers.includes(ac))) errors.push(`Passing verification receipts must cover ${ac}.`);
      }
      for (const { file, integrity } of receipts) evidence[file] = integrity;
      if (currentState.phase !== "implementing") {
        const verifiedEvent = currentState.history.find((event) => event.to === "verified");
        for (const { file, integrity } of receipts) {
          if (verifiedEvent?.evidence?.[file] !== integrity) errors.push(`Verification receipt changed after verification: ${file}.`);
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
    const protection = await inspectProtectedFiles(projectDir);
    for (const reason of protection.reasons) errors.push(reason);
    evidence["project-policy"] = protection.integrity;
    if (currentState.phase !== "implementing") {
      const verifiedEvent = currentState.history.find((event) => event.to === "verified");
      if (verifiedEvent?.evidence?.["project-policy"] !== protection.integrity) {
        errors.push("Protected-file policy changed after verification.");
      }
    }
  }

  if (target === "archived") {
    const exportFile = join(root, "export.md");
    const ownerFile = join(root, "export.owner.json");
    if (!existsSync(exportFile) || !existsSync(ownerFile)) {
      errors.push("Run openadk spec export before archiving.");
    } else {
      const payload = await readFile(exportFile, "utf8");
      const owner = await readJson(ownerFile);
      if (owner.integrity !== hashText(payload)) errors.push("export.md no longer matches its ownership record.");
      const state = await readJson(join(root, "spec-state.json"));
      if (owner.specId !== id || owner.statePhase !== state.phase || owner.stateRevision !== state.revision) {
        errors.push("export.md is stale; export the current verified revision before archiving.");
      }
      for (const artifact of ARTIFACTS) {
        const content = await need(artifact);
        if (owner.artifacts?.[artifact] !== hashText(content)) errors.push(`export.md is stale for ${artifact}.`);
      }
      evidence["export.md"] = hashText(payload);
    }
  }
  return { errors, evidence };
}

export async function checkSpec(projectDir, requestedId) {
  const state = await readSpec(projectDir, requestedId);
  const next = SPEC_PHASES[SPEC_PHASES.indexOf(state.phase) + 1] || null;
  const validation = next ? await validateTarget(projectDir, state.id, next, state) : { errors: [], evidence: {} };
  return { state, next, valid: validation.errors.length === 0, ...validation };
}

export async function advanceSpec(projectDir, requestedId, requestedTarget) {
  const state = await readSpec(projectDir, requestedId);
  if (state.phase === "archived") fail("E_SPEC_ARCHIVED", "Archived Specs are immutable.");
  const expected = SPEC_PHASES[SPEC_PHASES.indexOf(state.phase) + 1];
  const target = requestedTarget || expected;
  if (target !== expected) fail("E_SPEC_TRANSITION_INVALID", `Only ${state.phase} -> ${expected} is allowed.`);
  return withRecoverableLock(projectDir, join(specPath(projectDir, state.id), ".spec-state.lock"), async () => {
    const current = await readSpec(projectDir, state.id);
    if (current.revision !== state.revision || current.phase !== state.phase) fail("E_SPEC_STATE_CHANGED", "Spec state changed; read status and retry.");
    const validation = await validateTarget(projectDir, state.id, target, current);
    if (validation.errors.length > 0) fail("E_SPEC_GATE_FAILED", validation.errors.join(" "));
    const now = new Date().toISOString();
    const next = {
      ...current,
      phase: target,
      revision: current.revision + 1,
      updatedAt: now,
      history: [...current.history, historyEvent(current.revision + 1, current.phase, target, now, validation.evidence, current.history.at(-1).digest)]
    };
    await writeJsonAtomic(projectDir, join(specPath(projectDir, state.id), "spec-state.json"), next);
    await snapshotState(projectDir, next);
    return next;
  });
}

export async function exportSpec(projectDir, requestedId) {
  const state = await readSpec(projectDir, requestedId);
  if (state.phase === "archived") fail("E_SPEC_ARCHIVED", "Archived Specs are immutable.");
  const root = specPath(projectDir, state.id);
  const sections = [`# Spec Package: ${state.title}`, "", `- Spec ID: \`${state.id}\``, `- Phase: \`${state.phase}\``, `- Revision: ${state.revision}`, ""];
  const artifacts = {};
  for (const artifact of ARTIFACTS) {
    const target = join(root, artifact);
    await assertNoSymlinkWithin(projectDir, target);
    const content = await readFile(target, "utf8");
    sections.push("---", "", content.trim(), "");
    artifacts[artifact] = hashText(content);
  }
  const payload = `${sections.join("\n").trim()}\n`;
  const output = join(root, "export.md");
  const ownerPath = join(root, "export.owner.json");
  if (existsSync(output) && existsSync(ownerPath)) {
    const existing = await readFile(output, "utf8");
    const owner = await readJson(ownerPath);
    if (owner.integrity !== hashText(existing) && existing !== payload) fail("E_SPEC_EXPORT_MODIFIED", "Refusing to overwrite a modified export.");
  } else if (existsSync(output)) {
    fail("E_SPEC_EXPORT_MODIFIED", "Refusing to overwrite an export without an ownership record.");
  }
  await writeTextAtomic(projectDir, output, payload);
  await writeJsonAtomic(projectDir, ownerPath, { schemaVersion: 1, specId: state.id, stateRevision: state.revision, statePhase: state.phase, integrity: hashText(payload), artifacts });
  return output;
}
