import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = resolve("src/cli.js");

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

describe("openadk project safety", () => {
  it("requires one confirmation for an existing project and installs all native projections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-adoption-test-"));
    await writeFile(join(dir, "package.json"), "{}\n");

    const blocked = run(dir, ["start", "--no-launch"]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /onboarding requires confirmation/);
    assert.equal(existsSync(join(dir, ".openadk")), false);

    const adopted = run(dir, ["start", "--yes", "--no-launch"]);
    assert.equal(adopted.status, 0, adopted.stderr);
    for (const path of [
      ".agents/skills/openadk-orchestrator/SKILL.md",
      ".claude/skills/openadk-orchestrator/SKILL.md",
      ".cursor/skills/openadk-orchestrator/SKILL.md",
      ".opencode/skills/openadk-orchestrator/SKILL.md"
    ]) assert.ok(existsSync(join(dir, path)), path);
    const status = run(dir, ["project", "status"]);
    assert.equal(status.status, 0);
    assert.match(status.stdout, /Project state: healthy/);
  });

  it("blocks unmanaged conflicts and symbolic-link projection paths", async () => {
    const conflictDir = await mkdtemp(join(tmpdir(), "openadk-conflict-test-"));
    const conflict = join(conflictDir, ".agents/skills/openadk-orchestrator/SKILL.md");
    await mkdir(join(conflictDir, ".agents/skills/openadk-orchestrator"), { recursive: true });
    await writeFile(conflict, "customer-owned skill\n");
    const blocked = run(conflictDir, ["start", "--yes", "--no-launch"]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Unmanaged asset conflicts/);
    assert.equal(await readFile(conflict, "utf8"), "customer-owned skill\n");

    const symlinkDir = await mkdtemp(join(tmpdir(), "openadk-symlink-test-"));
    const outside = await mkdtemp(join(tmpdir(), "openadk-outside-test-"));
    await writeFile(join(symlinkDir, "package.json"), "{}\n");
    await symlink(outside, join(symlinkDir, ".agents"));
    const rejected = run(symlinkDir, ["start", "--yes", "--no-launch"]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /E_PATH_SYMLINK/);
    assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(outside)), []);
  });

  it("pins method assets and requires explicit upgrades", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-upgrade-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    const pinPath = join(dir, ".openadk/project-pin.json");
    const pin = JSON.parse(await readFile(pinPath, "utf8"));
    pin.methodVersion = "0.9.0";
    await writeFile(pinPath, `${JSON.stringify(pin, null, 2)}\n`);

    const available = run(dir, ["project", "upgrade", "status"]);
    assert.match(available.stdout, /upgrade-available/);
    assert.equal(run(dir, ["project", "upgrade", "apply"]).status, 1);
    const applied = run(dir, ["project", "upgrade", "apply", "--yes"]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Project state: healthy/);
  });

  it("recovers a trusted interrupted project asset transaction on start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-asset-recovery-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    const pin = JSON.parse(await readFile(join(dir, ".openadk/project-pin.json"), "utf8"));
    const journalPath = join(dir, ".openadk/project-assets.transaction.json");
    await writeFile(journalPath, `${JSON.stringify({
      schemaVersion: 1,
      targetVersion: pin.methodVersion,
      createdAt: new Date().toISOString(),
      before: pin.files,
      target: pin.files
    }, null, 2)}\n`);

    const recovered = run(dir, ["start", "--no-launch"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /Recovering an interrupted/);
    assert.equal(existsSync(journalPath), false);
    assert.match(run(dir, ["project", "status"]).stdout, /Project state: healthy/);
  });

  it("reclaims dead locks and recovers an initialized Spec pointer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-recovery-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    const lockPath = join(dir, ".openadk/spec.lock");
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      pid: 99999999,
      hostname: hostname(),
      token: "00000000-0000-4000-8000-000000000001",
      createdAt: new Date(0).toISOString()
    })}\n`);
    const created = run(dir, ["spec", "init", "recoverable task"]);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(existsSync(lockPath), false);

    await rm(join(dir, "specs/current.json"));
    const recovered = run(dir, ["spec", "init", "recoverable task"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /Created or recovered draft Spec/);
    assert.equal(JSON.parse(await readFile(join(dir, "specs/current.json"), "utf8")).id, "recoverable-task");
  });

  it("rejects a tampered Spec history chain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-history-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    assert.equal(run(dir, ["spec", "init", "history task"]).status, 0);
    const statePath = join(dir, "specs/history-task/spec-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.history[0].digest = "0".repeat(64);
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const status = run(dir, ["spec", "status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /E_SPEC_HISTORY_INVALID/);
  });

  it("recovers a tampered Spec state from the latest trusted snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-spec-snapshot-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    assert.equal(run(dir, ["spec", "init", "recover state", "--id", "recover-state"]).status, 0);
    const statePath = join(dir, "specs/recover-state/spec-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.phase = "archived";
    state.revision = 7;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    assert.equal(run(dir, ["spec", "status"]).status, 1);
    const recovered = run(dir, ["spec", "recover", "--yes"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /Recovered recover-state to draft \(revision 1\)/);
    assert.equal(run(dir, ["spec", "status"]).status, 0);
  });

  it("blocks protected-file drift without allowing silent re-baseline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-protection-test-"));
    await writeFile(join(dir, "README.md"), "original\n");
    await writeFile(join(dir, "package.json"), "{}\n");
    assert.equal(run(dir, ["start", "--yes", "--no-launch"]).status, 0);
    const protectedResult = run(dir, ["project", "protect", "README.md", "package.json"]);
    assert.equal(protectedResult.status, 0, protectedResult.stderr);
    assert.match(protectedResult.stdout, /Protected files: 2/);
    assert.match(run(dir, ["project", "protect", "status"]).stdout, /Protection state: healthy/);

    await writeFile(join(dir, "package.json"), "{\"changed\":true}\n");
    const status = run(dir, ["project", "status"]);
    assert.equal(status.status, 1);
    assert.match(status.stdout, /Protected file was modified: package.json/);
    const rebaseline = run(dir, ["project", "protect", "package.json"]);
    assert.equal(rebaseline.status, 1);
    assert.match(rebaseline.stderr, /Refusing to re-baseline modified protected file/);
  });

  it("reports project health and passes the repository purity audit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-doctor-test-"));
    assert.equal(run(dir, ["start", "--no-launch"]).status, 0);
    const doctor = run(dir, ["doctor", "--json"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
    assert.ok(report.checks.some((check) => check.id === "project.assets" && check.status === "pass"));

    const audit = run(process.cwd(), ["audit", "repo"]);
    assert.equal(audit.status, 0, audit.stderr);
    assert.match(audit.stdout, /repository audit passed/);
  });
});
