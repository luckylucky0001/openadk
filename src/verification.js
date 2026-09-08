import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertNoSymlinkWithin,
  fail,
  hashText,
  pathExists,
  readBoundedJson,
  writeJsonAtomic
} from "./runtime.js";

const RECEIPT_KINDS = new Set(["test", "adversarial", "static"]);
const MAX_COMMAND_OUTPUT = 16 * 1024 * 1024;

function receiptIntegrity(receipt) {
  const { integrity: _integrity, ...body } = receipt;
  return hashText(JSON.stringify(body));
}

function parseCoverage(value) {
  const ids = [...new Set((value || "").split(",").map((item) => item.trim()).filter(Boolean))].sort();
  if (ids.length === 0 || ids.some((id) => !/^AC-\d{3}$/.test(id))) {
    fail("E_VERIFY_COVERAGE_INVALID", "--covers must be a comma-separated list of AC-### IDs.");
  }
  return ids;
}

export async function runVerification(projectDir, state, { kind, covers, command, args = [] }) {
  if (!RECEIPT_KINDS.has(kind)) fail("E_VERIFY_KIND_INVALID", "--kind must be test, adversarial, or static.");
  if (!command) fail("E_VERIFY_COMMAND_REQUIRED", "A command is required after --.");
  if (state.phase !== "implementing") {
    fail("E_VERIFY_PHASE_INVALID", "Verification commands may only be recorded during the implementing phase.");
  }

  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT,
    shell: false
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const id = `VR-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const receipt = {
    schemaVersion: 1,
    id,
    specId: state.id,
    stateRevision: state.revision,
    statePhase: state.phase,
    kind,
    covers: parseCoverage(covers),
    command: { executable: command, args },
    cwd: ".",
    startedAt,
    durationMs: Date.now() - started,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    stdoutSha256: hashText(stdout),
    stderrSha256: hashText(stderr),
    passed: result.status === 0 && !result.error
  };
  receipt.integrity = receiptIntegrity(receipt);
  const output = resolve(projectDir, "specs", state.id, "receipts", `${id}.json`);
  await writeJsonAtomic(projectDir, output, receipt);
  return { receipt, stdout, stderr, error: result.error };
}

function validateReceipt(receipt, id, expectedRevision) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.specId !== id
    || receipt.statePhase !== "implementing" || receipt.stateRevision !== expectedRevision
    || !RECEIPT_KINDS.has(receipt.kind) || !Array.isArray(receipt.covers)
    || receipt.covers.length === 0 || receipt.covers.some((ac) => !/^AC-\d{3}$/.test(ac))
    || typeof receipt.command?.executable !== "string" || receipt.command.executable.length === 0
    || !Array.isArray(receipt.command.args) || receipt.command.args.some((arg) => typeof arg !== "string")
    || typeof receipt.passed !== "boolean" || receipt.integrity !== receiptIntegrity(receipt)) {
    fail("E_VERIFY_RECEIPT_INVALID", `Invalid verification receipt: ${receipt?.id || "unknown"}.`);
  }
}

export async function readVerificationReceipts(projectDir, id, expectedRevision) {
  const root = resolve(projectDir, "specs", id, "receipts");
  if (!await pathExists(root)) return [];
  await assertNoSymlinkWithin(projectDir, root);
  const files = (await readdir(root)).filter((file) => file.endsWith(".json")).sort();
  const receipts = [];
  for (const file of files) {
    const target = join(root, file);
    await assertNoSymlinkWithin(projectDir, target);
    const receipt = await readBoundedJson(target);
    validateReceipt(receipt, id, expectedRevision);
    receipts.push({ file: `receipts/${file}`, receipt, integrity: hashText(`${JSON.stringify(receipt, null, 2)}\n`) });
  }
  return receipts;
}
