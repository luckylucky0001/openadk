import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const cli = resolve("src/cli.js");


function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8"
  });
}

describe("openadk cli", () => {
  it("prints help", () => {
    const result = run(process.cwd(), ["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /OpenADK/);
    assert.match(result.stdout, /openadk spec/);
    assert.doesNotMatch(result.stdout, /openadk (?:sdd|sdt|run)\b/);
  });

  it("lists setup choices", () => {
    const result = run(process.cwd(), ["presets"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Agents:/);
    for (const agent of ["codex", "opencode", "claude", "cursor"]) {
      assert.match(result.stdout, new RegExp(`\\b${agent}\\b`));
    }
    assert.match(result.stdout, /Languages:/);
    assert.match(result.stdout, /backend/);
  });

  it("updates the project-level default agent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-config-test-"));

    assert.equal(run(dir, ["init", "--agent", "opencode", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    const before = run(dir, ["config"]);
    assert.equal(before.status, 0);
    assert.match(before.stdout, /Agent: opencode/);

    const claudeUpdate = run(dir, ["config", "--agent", "claude", "--model", "sonnet"]);
    assert.equal(claudeUpdate.status, 0, claudeUpdate.stderr);
    const claudeConfig = await readFile(join(dir, ".openadk/config.yaml"), "utf8");
    assert.match(claudeConfig, /^defaultAgent: claude/m);
    assert.match(claudeConfig, /claude:\n\s+command: claude\n\s+args: \["--model", "sonnet"\]/);

    const update = run(dir, ["config", "--agent", "codex"]);
    assert.equal(update.status, 0);
    const config = await readFile(join(dir, ".openadk/config.yaml"), "utf8");
    assert.match(config, /^defaultAgent: codex/m);

    const modelUpdate = run(dir, ["config", "--model", "gpt-5.5"]);
    assert.equal(modelUpdate.status, 0);
    const updatedConfig = await readFile(join(dir, ".openadk/config.yaml"), "utf8");
    assert.match(updatedConfig, /args: \["--model", "gpt-5\.5"\]/);

    const after = run(dir, ["config"]);
    assert.equal(after.status, 0);
    assert.match(after.stdout, /Agent: codex/);
    assert.match(after.stdout, /Language: javascript/);
    assert.match(after.stdout, /Preset: backend/);
    assert.match(after.stdout, /Agent args: --model gpt-5\.5/);
  });

  it("launches every supported native Agent without a shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-code-test-"));
    const binDir = join(dir, "bin");
    await import("node:fs/promises").then(async ({ chmod, mkdir }) => {
      await mkdir(binDir);
      for (const [agent, command] of [
        ["codex", "codex"],
        ["opencode", "opencode"],
        ["claude", "claude"],
        ["cursor", "cursor-agent"]
      ]) {
        await writeFile(join(binDir, command), `#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PWD/${agent}-args.txt\"\n`);
        await chmod(join(binDir, command), 0o755);
      }
    });
    assert.equal(run(dir, ["init", "--agent", "codex", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    for (const agent of ["codex", "opencode", "claude", "cursor"]) {
      const result = spawnSync(process.execPath, [cli, "code", "--agent", agent, "--", "--probe", agent], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
      });
      assert.equal(result.status, 0, `${agent}: ${result.stderr}`);
      assert.equal(await readFile(join(dir, `${agent}-args.txt`), "utf8"), `--probe\n${agent}\n`);
    }
  });


  it("prepares a project and native Codex skill from one start command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-start-test-"));
    const result = run(dir, ["start", "--no-launch"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /OpenADK is ready/);
    assert.ok(existsSync(join(dir, ".openadk/config.yaml")));
    const skill = await readFile(join(dir, ".agents/skills/openadk-orchestrator/SKILL.md"), "utf8");
    assert.match(skill, /openadk spec status/);
    assert.match(skill, /draft -> specified -> planned -> tasked -> implementing -> verified -> archived/);
    assert.match(skill, /openadk verify run --kind adversarial/);
    assert.match(skill, /Do not encode FR or AC definitions in Markdown tables/);
  });

  it("creates a draft Spec and rejects an incomplete requirements gate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-spec-gate-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    assert.equal(run(dir, ["spec", "init", "add audit trail"]).status, 0);

    const state = JSON.parse(await readFile(join(dir, "specs/add-audit-trail/spec-state.json"), "utf8"));
    assert.equal(state.phase, "draft");
    assert.equal(state.revision, 1);
    const check = run(dir, ["spec", "check"]);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /Gate: FAIL/);
    assert.match(check.stdout, /Open Questions must explicitly say None/);
    const rejected = run(dir, ["spec", "advance", "planned"]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Only draft -> specified is allowed/);
  });

  it("advances a complete Spec through evidence-backed adjacent phases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-spec-journey-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    await writeFile(join(dir, "immutable.txt"), "baseline\n");
    assert.equal(run(dir, ["project", "protect", "immutable.txt"]).status, 0);
    assert.equal(run(dir, ["spec", "init", "add audit trail"]).status, 0);
    const specDir = join(dir, "specs/add-audit-trail");

    await writeFile(join(specDir, "requirements.md"), `# Requirements: Add audit trail

## Problem
Operators cannot trace important account changes after an incident.
## Goals
- Record durable audit events for account updates.
## Non-goals
- Cross-region analytics is outside this change.
## Users and Scenarios
- Support engineers inspect an account change timeline.
## Functional Requirements
- FR-001: Record an audit event for every account update.
## Quality Attributes
- Audit writes must preserve the existing update contract.
## Acceptance Criteria
- [x] AC-001: A successful account update creates one audit event.
## Open Questions
None
`);
    await writeFile(join(specDir, "design.md"), `# Design: Add audit trail

## Context and Constraints
The existing service uses a local repository abstraction and Node.js.
## Architecture
Add an audit writer called from the account update transaction boundary.
## Interfaces and Data
Audit records contain actor, account, operation, and timestamp fields.
## Failure Handling
The account update rolls back when the required audit write fails.
## Security and Privacy
Records omit secrets and retain only approved account identifiers.
## Verification Strategy
Unit tests cover success, failure, and exactly-once event creation.
## Migration and Rollback
The additive table can be removed after disabling the writer safely.
`);
    await writeFile(join(specDir, "decisions.md"), `# Decisions: Add audit trail

## D-001: Write audit records transactionally
- Status: accepted
- Context: Account changes and their audit evidence must remain consistent.
- Decision: Write the audit event in the existing account transaction.
- Consequences: Audit storage failure also rejects the account update safely.
`);
    await writeFile(join(specDir, "tasks.md"), `# Tasks: Add audit trail

- [x] T-001: Implement and test the transactional audit writer (FR-001, AC-001)
`);
    await writeFile(join(specDir, "verification.md"), `# Verification: Add audit trail

## Evidence
- V-001: The audit writer test confirms exactly one event per update (AC-001).
## Commands
- \`npm test\` passed: tests 12, pass 12, fail 0, skipped 0, todo 0.
## Residual Risks
- Cross-process delivery remains outside the approved scope.
`);

    for (const phase of ["specified", "planned", "tasked", "implementing"]) {
      const result = run(dir, ["spec", "advance"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`to ${phase}`));
    }
    const markdownOnly = run(dir, ["spec", "advance"]);
    assert.equal(markdownOnly.status, 1);
    assert.match(markdownOnly.stderr, /passing test receipt/);

    const testReceipt = run(dir, [
      "verify", "run", "--kind", "test", "--covers", "AC-001", "--",
      process.execPath, "-e", "process.exit(0)"
    ]);
    assert.equal(testReceipt.status, 0, testReceipt.stderr);
    assert.match(testReceipt.stdout, /Verification receipt: VR-.+\(test, PASS\)/);
    const missingAdversarial = run(dir, ["spec", "check"]);
    assert.equal(missingAdversarial.status, 1);
    assert.match(missingAdversarial.stdout, /separate passing adversarial receipt/);

    const failedAdversarial = run(dir, [
      "verify", "run", "--kind", "adversarial", "--covers", "AC-001", "--",
      process.execPath, "-e", "process.exit(9)"
    ]);
    assert.equal(failedAdversarial.status, 9);
    assert.match(failedAdversarial.stdout, /\(adversarial, FAIL\)/);
    assert.match(run(dir, ["spec", "check"]).stdout, /separate passing adversarial receipt/);

    const adversarialReceipt = run(dir, [
      "verify", "run", "--kind", "adversarial", "--covers", "AC-001", "--",
      process.execPath, "-e", "process.exit(0)"
    ]);
    assert.equal(adversarialReceipt.status, 0, adversarialReceipt.stderr);
    assert.equal(run(dir, ["spec", "advance"]).status, 0);
    assert.equal(run(dir, ["spec", "export"]).status, 0);
    assert.ok(existsSync(join(specDir, "export.md")));
    assert.ok(existsSync(join(specDir, "export.owner.json")));
    const policyPath = join(dir, ".openadk/protected-files.json");
    const originalPolicy = await readFile(policyPath, "utf8");
    await writeFile(join(dir, "late-protection.txt"), "late\n");
    assert.equal(run(dir, ["project", "protect", "late-protection.txt"]).status, 0);
    const policyChanged = run(dir, ["spec", "advance"]);
    assert.equal(policyChanged.status, 1);
    assert.match(policyChanged.stderr, /Protected-file policy changed after verification/);
    await writeFile(policyPath, originalPolicy);
    const receiptDir = join(specDir, "receipts");
    const receiptPath = join(receiptDir, (await readdir(receiptDir)).sort()[0]);
    const originalReceipt = await readFile(receiptPath, "utf8");
    const changedReceipt = JSON.parse(originalReceipt);
    changedReceipt.stdoutSha256 = "0".repeat(64);
    await writeFile(receiptPath, `${JSON.stringify(changedReceipt, null, 2)}\n`);
    const receiptTampered = run(dir, ["spec", "advance"]);
    assert.equal(receiptTampered.status, 1);
    assert.match(receiptTampered.stderr, /Invalid verification receipt/);
    await writeFile(receiptPath, originalReceipt);
    const originalExport = await readFile(join(specDir, "export.md"), "utf8");
    await writeFile(join(specDir, "export.md"), "customer-modified export\n");
    const tampered = run(dir, ["spec", "advance"]);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /export.md no longer matches its ownership record/);
    const overwrite = run(dir, ["spec", "export"]);
    assert.equal(overwrite.status, 1);
    assert.match(overwrite.stderr, /Refusing to overwrite a modified export/);
    await writeFile(join(specDir, "export.md"), originalExport);
    assert.equal(run(dir, ["spec", "advance"]).status, 0);

    const state = JSON.parse(await readFile(join(specDir, "spec-state.json"), "utf8"));
    assert.equal(state.phase, "archived");
    assert.equal(state.revision, 7);
    assert.equal(state.history.length, 7);
  });
});
