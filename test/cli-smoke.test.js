import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const cli = resolve("src/cli.js");

function escapedCwdPattern(dir) {
  const variants = [dir];
  if (dir.startsWith("/var/")) variants.push(`/private${dir}`);
  return `(?:${variants.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
}

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
    assert.match(result.stdout, /openadk sdd/);
  });

  it("lists setup choices", () => {
    const result = run(process.cwd(), ["presets"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Agents:/);
    assert.match(result.stdout, /Languages:/);
    assert.match(result.stdout, /backend/);
  });

  it("updates the project-level default agent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-config-test-"));

    assert.equal(run(dir, ["init", "--agent", "opencode", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    const before = run(dir, ["config"]);
    assert.equal(before.status, 0);
    assert.match(before.stdout, /Agent: opencode/);

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

  it("runs codex through the non-interactive exec entrypoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-agent-test-"));
    const binDir = join(dir, "bin");
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(binDir).then(() =>
        writeFile(
          join(binDir, "codex"),
          "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PWD/codex-args.txt\"\ncat > \"$PWD/codex-stdin.txt\"\n"
        )
      )
    );
    await import("node:fs/promises").then(({ chmod }) => chmod(join(binDir, "codex"), 0o755));

    assert.equal(run(dir, ["init", "--agent", "codex", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    assert.equal(run(dir, ["sdd", "ff", "add version endpoint"]).status, 0);
    const result = spawnSync(process.execPath, [cli, "sdd", "implement", "--run"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    assert.equal(result.status, 0);
    const args = await readFile(join(dir, "codex-args.txt"), "utf8");
    const stdin = await readFile(join(dir, "codex-stdin.txt"), "utf8");
    assert.match(args, new RegExp(`^exec\\n--skip-git-repo-check\\n--ephemeral\\n--sandbox\\nworkspace-write\\n-C\\n${escapedCwdPattern(dir)}\\n-`));
    assert.match(stdin, /OpenADK Agent Implementation Prompt/);
  });

  it("can ask an agent to complete SDD fast-forward artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-sdd-run-test-"));
    const binDir = join(dir, "bin");
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(binDir).then(() =>
        writeFile(
          join(binDir, "codex"),
          "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PWD/codex-args.txt\"\ncat > \"$PWD/codex-stdin.txt\"\n"
        )
      )
    );
    await import("node:fs/promises").then(({ chmod }) => chmod(join(binDir, "codex"), 0o755));

    assert.equal(run(dir, ["init", "--agent", "codex", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    const result = spawnSync(process.execPath, [cli, "sdd", "ff", "--run", "add version endpoint", "--", "--model", "gpt-5"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    assert.equal(result.status, 0);
    const specs = await readdir(join(dir, "specs"));
    const specDir = specs.find((entry) => entry.includes("add-version-endpoint"));
    assert.ok(specDir);
    assert.ok(existsSync(join(dir, "specs", specDir, "sdd-generation-prompt.md")));
    const args = await readFile(join(dir, "codex-args.txt"), "utf8");
    const stdin = await readFile(join(dir, "codex-stdin.txt"), "utf8");
    assert.match(args, new RegExp(`^exec\\n--skip-git-repo-check\\n--ephemeral\\n--sandbox\\nworkspace-write\\n-C\\n${escapedCwdPattern(dir)}\\n--model\\ngpt-5\\n-`));
    assert.match(stdin, /OpenADK SDD Generation Prompt/);
    assert.match(stdin, /Overwrite these files/);
    assert.match(stdin, /Do not implement code in this step/);
  });

  it("can ask an agent to complete SDT artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-sdt-run-test-"));
    const binDir = join(dir, "bin");
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(binDir).then(() =>
        writeFile(
          join(binDir, "codex"),
          "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PWD/codex-args.txt\"\ncat > \"$PWD/codex-stdin.txt\"\n"
        )
      )
    );
    await import("node:fs/promises").then(({ chmod }) => chmod(join(binDir, "codex"), 0o755));

    assert.equal(run(dir, ["init", "--agent", "codex", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    assert.equal(run(dir, ["sdd", "ff", "add version endpoint"]).status, 0);
    const result = spawnSync(process.execPath, [cli, "sdt", "ff", "--run", "--", "--model", "gpt-5"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    assert.equal(result.status, 0);
    const specs = await readdir(join(dir, "specs"));
    const specDir = specs.find((entry) => entry.includes("add-version-endpoint"));
    assert.ok(specDir);
    assert.ok(existsSync(join(dir, "specs", specDir, "sdt-generation-prompt.md")));
    const args = await readFile(join(dir, "codex-args.txt"), "utf8");
    const stdin = await readFile(join(dir, "codex-stdin.txt"), "utf8");
    assert.match(args, new RegExp(`^exec\\n--skip-git-repo-check\\n--ephemeral\\n--sandbox\\nworkspace-write\\n-C\\n${escapedCwdPattern(dir)}\\n--model\\ngpt-5\\n-`));
    assert.match(stdin, /OpenADK SDT Generation Prompt/);
    assert.match(stdin, /Overwrite these files/);
    assert.match(stdin, /Do not implement product code/);
  });

  it("runs the full SDD to SDT workflow with the configured agent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-full-run-test-"));
    const binDir = join(dir, "bin");
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(binDir).then(() =>
        writeFile(
          join(binDir, "codex"),
          [
            "#!/bin/sh",
            "printf '%s\\n' '---args---' >> \"$PWD/codex-args.txt\"",
            "printf '%s\\n' \"$@\" >> \"$PWD/codex-args.txt\"",
            "printf '%s\\n' '---stdin---' >> \"$PWD/codex-stdin.txt\"",
            "cat >> \"$PWD/codex-stdin.txt\""
          ].join("\n")
        )
      )
    );
    await import("node:fs/promises").then(({ chmod }) => chmod(join(binDir, "codex"), 0o755));

    assert.equal(run(dir, ["init", "--agent", "codex", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    assert.equal(run(dir, ["config", "--model", "gpt-5.5"]).status, 0);
    const result = spawnSync(process.execPath, [cli, "run", "--no-test", "add version endpoint"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
    });
    assert.equal(result.status, 0);

    const specs = await readdir(join(dir, "specs"));
    const specDir = specs.find((entry) => entry.includes("add-version-endpoint"));
    assert.ok(specDir);
    assert.ok(existsSync(join(dir, "specs", specDir, "sdd-generation-prompt.md")));
    assert.ok(existsSync(join(dir, "specs", specDir, "implement-prompt.md")));
    assert.ok(existsSync(join(dir, "specs", specDir, "sdt-generation-prompt.md")));

    const args = await readFile(join(dir, "codex-args.txt"), "utf8");
    const stdin = await readFile(join(dir, "codex-stdin.txt"), "utf8");
    assert.equal((args.match(/---args---/g) || []).length, 3);
    assert.match(args, /--model\ngpt-5\.5/);
    assert.match(stdin, /OpenADK SDD Generation Prompt/);
    assert.match(stdin, /OpenADK Agent Implementation Prompt/);
    assert.match(stdin, /OpenADK SDT Generation Prompt/);
  });

  it("runs tests and writes SDT reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-sdt-test-"));
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          type: "module",
          scripts: { test: "node --test test/*.test.js" }
        })
      )
    );
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(join(dir, "test")).then(() =>
        writeFile(
          join(dir, "test", "sample.test.js"),
          "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => assert.equal(1, 1));\n"
        )
      )
    );

    assert.equal(run(dir, ["init", "--agent", "codex", "--language", "javascript", "--preset", "backend", "--yes"]).status, 0);
    assert.equal(run(dir, ["sdd", "ff", "add sample behavior"]).status, 0);
    assert.equal(run(dir, ["sdt", "ff"]).status, 0);
    const result = run(dir, ["sdt", "run"]);
    assert.equal(result.status, 0);
    const specs = await readdir(join(dir, "specs"));
    const specDir = specs.find((entry) => entry.includes("add-sample-behavior"));
    assert.ok(specDir);
    const testRun = await readFile(join(dir, "specs", specDir, "test-run.md"), "utf8");
    const testReport = await readFile(join(dir, "specs", specDir, "test-report.md"), "utf8");
    assert.match(testRun, /npm test/);
    assert.match(testRun, /Status: Passed/);
    assert.match(testReport, /Recommend release/);
  });

  it("creates init, SDD, and SDT artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openadk-test-"));

    assert.equal(run(dir, ["init", "--agent", "codex", "--language", "go", "--preset", "backend"]).status, 0);
    assert.ok(existsSync(join(dir, ".openadk/config.yaml")));
    assert.ok(existsSync(join(dir, ".openadk/memory/language.md")));
    assert.ok(existsSync(join(dir, ".openadk/presets/backend.md")));

    assert.equal(run(dir, ["sdd", "ff", "add passwordless login"]).status, 0);
    assert.equal(run(dir, ["sdd", "implement", "keep the change minimal"]).status, 0);
    const specs = await readdir(join(dir, "specs"));
    const specDir = specs.find((entry) => entry.includes("passwordless-login"));
    assert.ok(specDir);
    assert.ok(existsSync(join(dir, "specs", specDir, "spec.md")));
    assert.ok(existsSync(join(dir, "specs", specDir, "implement-prompt.md")));
    const prompt = await readFile(join(dir, "specs", specDir, "implement-prompt.md"), "utf8");
    assert.match(prompt, /Backend Preset/);
    assert.match(prompt, /Language: go/);

    assert.equal(run(dir, ["sdt", "ff"]).status, 0);
    const report = await readFile(join(dir, "specs", specDir, "test-report.md"), "utf8");
    assert.match(report, /Release Recommendation/);
  });
});
