#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const VERSION = "0.1.0";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AGENTS = ["codex", "opencode", "cursor"];
const LANGUAGES = ["javascript", "typescript", "python", "go", "java", "rust", "swift", "kotlin"];
const PRESETS = {
  backend: {
    description: "Backend service development with API, data, reliability, and integration guidance."
  },
  frontend: {
    description: "Frontend application development with UX states, accessibility, and component guidance."
  },
  mobile: {
    description: "Mobile client development with platform constraints, offline behavior, and release safety."
  },
  fullstack: {
    description: "Full-stack development combining frontend, backend, API contract, and integration guidance."
  },
  common: {
    description: "Common workflow guidance for libraries, tools, scripts, and mixed repositories."
  }
};

const LANGUAGE_GUIDES = {
  javascript: "Prefer npm scripts, Node test runner or project-local test framework, and explicit async error handling.",
  typescript: "Prefer strict types, project-local lint/typecheck scripts, and typed public interfaces.",
  python: "Prefer virtualenv-aware commands, pytest when available, and explicit dependency boundaries.",
  go: "Prefer go test ./..., table-driven tests, context-aware APIs, and explicit error returns.",
  java: "Prefer Maven/Gradle project conventions, clear package boundaries, and integration-test separation.",
  rust: "Prefer cargo test, Result-based errors, ownership-friendly APIs, and minimal unsafe code.",
  swift: "Prefer XCTest, platform lifecycle awareness, and clear separation of UI and domain behavior.",
  kotlin: "Prefer Gradle conventions, coroutine safety, null-safety, and platform-aware tests."
};

const TEMPLATES = {
  "constitution.md": `# Constitution

## Engineering Principles

- Prefer small, reviewable changes.
- Keep behavior verifiable with tests or explicit checks.
- Preserve existing project conventions unless there is a clear reason to change them.

## AI Agent Rules

- Read the local context before editing.
- Follow the active spec, plan, and tasks.
- Report commands run and residual risks.
`,
  "coding.md": `# Coding Guidelines

## Style

- Follow the repository's existing formatting and naming conventions.
- Avoid broad refactors while implementing narrow features.

## Error Handling

- Fail explicitly when input is invalid.
- Include actionable error messages.
`,
  "quality.md": `# Quality Guidelines

## Required Checks

- Unit tests for core logic.
- Integration or smoke tests for user-facing workflows.
- Manual verification notes when automation is not available.
`,
  "reliability.md": `# Reliability Guidelines

## Expectations

- Consider retries, timeouts, idempotency, and partial failure.
- Keep operational behavior observable through logs or reports.
`,
  "security.md": `# Security Guidelines

## Expectations

- Do not commit secrets.
- Treat external input as untrusted.
- Document permission and data access assumptions.
`
};

const WORKFLOW_TEMPLATES = {
  brainstorm: `# Brainstorm

## Problem

{{input}}

## Goals

- TBD

## Constraints

- TBD

## Candidate Approaches

- TBD

## Recommendation

- TBD
`,
  spec: `# Feature Spec

## User Goal

{{input}}

## Scope

- TBD

## Non-Goals

- TBD

## User Stories

- As a user, I want TBD, so that TBD.

## Functional Requirements

- TBD

## Non-Functional Requirements

- TBD

## Edge Cases

- TBD

## Acceptance Criteria

- TBD

## Open Questions

- TBD
`,
  plan: `# Implementation Plan

## Context

- TBD

## Current Architecture

- TBD

## Proposed Changes

- TBD

## Files To Touch

- TBD

## Data Model

- TBD

## API / Contract Changes

- TBD

## Risks

- TBD

## Validation Plan

- TBD
`,
  tasks: `# Tasks

## Phase 1: Setup

- [ ] T001 Review spec and plan.

## Phase 2: Core Implementation

- [ ] T002 Implement the smallest useful behavior.

## Phase 3: Tests

- [ ] T003 Add or update verification.

## Phase 4: Docs / Cleanup

- [ ] T004 Update docs and summarize residual risks.
`,
  "implement-prompt": `# Implementation Prompt

You are implementing the active OpenADK SDD task.

## Instructions

1. Read \`spec.md\`, \`plan.md\`, and \`tasks.md\`.
2. Implement only the scoped behavior.
3. Add or update tests where practical.
4. Record commands run and residual risks.
5. Do not broaden the change beyond the spec without calling it out.

## Extra Request

{{input}}
`,
  review: `# Review

## Findings

- TBD

## Spec Alignment

- TBD

## Test Gaps

- TBD

## Recommendation

- TBD
`,
  archive: `# Archive

## Summary

- TBD

## Decisions

- TBD

## Reusable Knowledge

- TBD

## Follow-Ups

- TBD
`,
  "test-analysis": `# Test Analysis

## Risk Areas

- TBD

## Boundaries

- TBD

## Dependencies

- TBD

## Suggested Coverage

- TBD
`,
  "test-cases": `# Test Cases

| ID | Scenario | Steps | Expected | Priority |
| --- | --- | --- | --- | --- |
| TC001 | TBD | TBD | TBD | P1 |
`,
  "test-run": `# Test Run

## Commands

- TBD

## Results

- TBD

## Logs

- TBD
`,
  "test-report": `# Test Report

## Summary

- TBD

## Passing Cases

- TBD

## Failing Cases

- TBD

## Coverage Gaps

- TBD

## Residual Risks

- TBD

## Release Recommendation

- TBD
`
};

function printHelp() {
  console.log(`OpenADK ${VERSION}

A workflow layer for reliable AI-assisted software delivery.

Usage:
  openadk init [--agent codex|opencode|cursor] [--language typescript] [--preset backend] [--yes]
  openadk config [--agent codex|opencode|cursor] [--language typescript] [--preset backend] [--model gpt-5]
  openadk presets
  openadk code [--agent codex|opencode|cursor|-t codex] [-- ...agentArgs]
  openadk run [--agent codex] [--no-test] "requirement" [-- ...agentArgs]
  openadk sdd <brainstorm|specify|plan|tasks|implement|ff|review|archive> [--agent codex] [--run] [text]
  openadk sdt <analyze|cases|run|report|ff> [--agent codex] [--run] [text]

Examples:
  openadk init --agent codex --language typescript --preset backend
  openadk config --agent codex --model gpt-5
  openadk init
  openadk presets
  openadk run "add passwordless login"
  openadk sdd ff "add passwordless login"
  openadk sdd implement --run
  openadk sdt ff --run
  openadk sdt run
  openadk code
  openadk sdt ff
`);
}

function parseFlag(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function hasFlag(args, name) {
  return args.includes(name);
}

function stripFlags(args, flags) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (flags.includes(args[i])) {
      i += 1;
    } else {
      out.push(args[i]);
    }
  }
  return out;
}

function splitShellWords(value) {
  if (!value) return [];
  const words = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) words.push(current);
  return words;
}

function formatYamlList(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function parseYamlInlineList(value = "") {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[]") return [];
  try {
    const parsed = JSON.parse(trimmed.replace(/'/g, "\""));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return splitShellWords(trimmed.replace(/^\[/, "").replace(/\]$/, "").replaceAll(",", " "));
  }
}

async function promptChoice(label, allowed, fallback) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${label} (${allowed.join("/")}) [${fallback}]: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function parseInitChoice(args, flag, label, allowed, fallback, interactive) {
  const direct = parseFlag(args, flag, undefined);
  if (direct) return direct;
  return interactive ? promptChoice(label, allowed, fallback) : fallback;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "agent-task";
}

async function writeIfMissing(file, content) {
  if (existsSync(file)) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return true;
}

async function readMaybe(file) {
  if (!existsSync(file)) return "";
  return readFile(file, "utf8");
}

async function initProject(args) {
  const cwd = process.cwd();
  const interactive = !hasFlag(args, "--yes") && !hasFlag(args, "-y");
  const defaultAgent = await parseInitChoice(args, "--agent", "Agent", AGENTS, "codex", interactive);
  const language = await parseInitChoice(args, "--language", "Language", LANGUAGES, "typescript", interactive);
  const preset = await parseInitChoice(args, "--preset", "Preset", Object.keys(PRESETS), "common", interactive);
  validateChoice("agent", defaultAgent, AGENTS);
  validateChoice("language", language, LANGUAGES);
  validateChoice("preset", preset, Object.keys(PRESETS));

  const presetFiles = [[`.openadk/presets/${preset}.md`, await loadPackagedPreset(preset)]];

  const files = [
    [".openadk/config.yaml", defaultConfigText(defaultAgent, language, preset)],
    ...Object.entries(TEMPLATES).map(([name, content]) => [`.openadk/memory/${name}`, content]),
    [".openadk/memory/language.md", languageGuide(language)],
    ...presetFiles,
    ["docs/arch/index.md", "# Architecture Knowledge\n\n- Add reusable architecture notes here.\n"],
    ["docs/product-specs/index.md", "# Product Specs\n\n- Add reusable product context here.\n"],
    ["docs/references/index.md", "# References\n\n- Add external or internal references here.\n"],
    ["specs/.gitkeep", ""]
  ];

  let created = 0;
  for (const [file, content] of files) {
    if (await writeIfMissing(join(cwd, file), content)) created += 1;
  }

  console.log(`Initialized OpenADK in ${cwd}`);
  console.log(`Created ${created} file(s). Agent: ${defaultAgent}. Language: ${language}. Preset: ${preset}.`);
}

function validateChoice(name, value, allowed) {
  if (allowed.includes(value)) return;
  console.error(`Unknown ${name}: ${value}`);
  console.error(`Allowed ${name}s: ${allowed.join(", ")}`);
  process.exit(1);
}

function languageGuide(language) {
  return `# Language Guide: ${language}

${LANGUAGE_GUIDES[language]}

## SDD Notes

- Align implementation plans with this language's package, build, and test conventions.
- Prefer existing project scripts over inventing new commands.

## SDT Notes

- Record exact commands used for tests, type checks, linting, and smoke verification.
`;
}

async function loadPackagedPreset(preset) {
  const file = join(PACKAGE_ROOT, "presets", `${preset}.md`);
  const content = await readMaybe(file);
  if (content) return content;
  return `# ${preset} Preset\n\nNo packaged preset file was found. Add guidance here.\n`;
}

function listPresets() {
  console.log("Agents:");
  for (const agent of AGENTS) console.log(`  ${agent}`);
  console.log("\nLanguages:");
  for (const language of LANGUAGES) console.log(`  ${language}`);
  console.log("\nPresets:");
  for (const [name, preset] of Object.entries(PRESETS)) {
    console.log(`  ${name} - ${preset.description}`);
  }
}

async function loadConfig() {
  const configPath = resolve(".openadk/config.yaml");
  const text = await readMaybe(configPath);
  const defaultAgent = text.match(/^defaultAgent:\s*(\S+)/m)?.[1] || "codex";
  const language = text.match(/^language:\s*(\S+)/m)?.[1] || "typescript";
  const preset = text.match(/^preset:\s*(\S+)/m)?.[1] || "common";
  const agentBlock = (agent) => text.match(new RegExp(`${agent}:\\n((?:\\s{4}.+\\n?)*)`, "m"))?.[1] || "";
  const commandFor = (agent) => {
    return agentBlock(agent).match(/^\s+command:\s*(\S+)/m)?.[1] || defaultCommand(agent);
  };
  const argsFor = (agent) => {
    const argsText = agentBlock(agent).match(/^\s+args:\s*(.+)$/m)?.[1] || "[]";
    return parseYamlInlineList(argsText);
  };
  return { defaultAgent, language, preset, commandFor, argsFor };
}

function defaultConfigText(defaultAgent = "codex", language = "typescript", preset = "common") {
  return `defaultAgent: ${defaultAgent}
language: ${language}
preset: ${preset}
agents:
  codex:
    command: codex
    args: []
  opencode:
    command: opencode
    args: []
  cursor:
    command: cursor-agent
    args: []
`;
}

function upsertTopLevelConfigValue(text, key, value) {
  const line = `${key}: ${value}`;
  if (new RegExp(`^${key}:\\s*\\S+`, "m").test(text)) {
    return text.replace(new RegExp(`^${key}:\\s*\\S+`, "m"), line);
  }
  return `${line}\n${text}`;
}

async function configureProject(args) {
  const configPath = resolve(".openadk/config.yaml");
  const current = await loadConfig();
  const nextAgent = parseFlag(args, "--agent", parseFlag(args, "-t", current.defaultAgent));
  const nextLanguage = parseFlag(args, "--language", current.language);
  const nextPreset = parseFlag(args, "--preset", current.preset);
  const nextModel = parseFlag(args, "--model", undefined);
  const nextAgentArgs = parseFlag(args, "--agent-args", undefined);
  validateChoice("agent", nextAgent, AGENTS);
  validateChoice("language", nextLanguage, LANGUAGES);
  validateChoice("preset", nextPreset, Object.keys(PRESETS));

  const changed =
    nextAgent !== current.defaultAgent ||
    nextLanguage !== current.language ||
    nextPreset !== current.preset ||
    nextModel !== undefined ||
    nextAgentArgs !== undefined;

  if (
    !changed &&
    !hasFlag(args, "--agent") &&
    !hasFlag(args, "-t") &&
    !hasFlag(args, "--language") &&
    !hasFlag(args, "--preset") &&
    !hasFlag(args, "--model") &&
    !hasFlag(args, "--agent-args")
  ) {
    console.log(`Agent: ${current.defaultAgent}`);
    console.log(`Language: ${current.language}`);
    console.log(`Preset: ${current.preset}`);
    console.log(`Agent args: ${current.argsFor(current.defaultAgent).join(" ") || "(none)"}`);
    return;
  }

  let text = await readMaybe(configPath);
  if (!text.trim()) text = defaultConfigText(current.defaultAgent, current.language, current.preset);
  text = upsertTopLevelConfigValue(text, "defaultAgent", nextAgent);
  text = upsertTopLevelConfigValue(text, "language", nextLanguage);
  text = upsertTopLevelConfigValue(text, "preset", nextPreset);
  if (nextModel !== undefined || nextAgentArgs !== undefined) {
    const agentArgs = nextAgentArgs !== undefined ? splitShellWords(nextAgentArgs) : ["--model", nextModel];
    text = upsertAgentArgs(text, nextAgent, agentArgs);
  }
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, text);

  console.log(`Updated ${configPath}`);
  console.log(`Agent: ${nextAgent}. Language: ${nextLanguage}. Preset: ${nextPreset}.`);
  const displayedAgentArgs = nextModel !== undefined || nextAgentArgs !== undefined
    ? (nextAgentArgs !== undefined ? splitShellWords(nextAgentArgs) : ["--model", nextModel])
    : current.argsFor(nextAgent);
  console.log(`Agent args: ${displayedAgentArgs.join(" ") || "(none)"}.`);
}

function upsertAgentArgs(text, agent, args) {
  const formatted = `    args: ${formatYamlList(args)}`;
  const agentPattern = new RegExp(`(${agent}:\\n(?:\\s{4}.+\\n?)*)`, "m");
  const match = text.match(agentPattern);
  if (!match) {
    return `${text.trimEnd()}\n  ${agent}:\n    command: ${defaultCommand(agent)}\n${formatted}\n`;
  }
  const block = match[1];
  const nextBlock = /^\s+args:/m.test(block)
    ? block.replace(/^\s+args:\s*.*$/m, formatted)
    : `${block.trimEnd()}\n${formatted}\n`;
  return text.replace(block, nextBlock);
}

function defaultCommand(agent) {
  if (agent === "cursor") return "cursor-agent";
  return agent;
}

function agentRunInvocation(agent, command, agentArgs) {
  if (agent === "codex" && command === "codex") {
    const hasPromptMarker = agentArgs.includes("-");
    const hasSandbox = agentArgs.includes("-s") || agentArgs.includes("--sandbox");
    const hasEphemeral = agentArgs.includes("--ephemeral");
    const hasCd = agentArgs.includes("-C") || agentArgs.includes("--cd");
    const defaults = [
      "--skip-git-repo-check",
      ...(hasEphemeral ? [] : ["--ephemeral"]),
      ...(hasSandbox ? [] : ["--sandbox", "workspace-write"]),
      ...(hasCd ? [] : ["-C", process.cwd()])
    ];
    const args = ["exec", ...defaults, ...agentArgs];
    if (!hasPromptMarker) args.push("-");
    return { command, args };
  }
  return { command, args: agentArgs };
}

function splitOwnAndAgentArgs(args) {
  const separator = args.indexOf("--");
  return {
    ownArgs: separator === -1 ? args : args.slice(0, separator),
    agentArgs: separator === -1 ? [] : args.slice(separator + 1)
  };
}

function commandText(args) {
  const { ownArgs } = splitOwnAndAgentArgs(args);
  return stripFlags(ownArgs, ["--agent", "-t", "--model", "--agent-args"])
    .filter((arg) => arg !== "--run")
    .filter((arg) => arg !== "--no-test")
    .join(" ")
    .trim();
}

async function runCode(args) {
  const separator = args.indexOf("--");
  const ownArgs = separator === -1 ? args : args.slice(0, separator);
  const agentArgs = separator === -1 ? [] : args.slice(separator + 1);
  const config = await loadConfig();
  const agent = parseFlag(ownArgs, "--agent", parseFlag(ownArgs, "-t", config.defaultAgent));
  validateChoice("agent", agent, AGENTS);
  const command = config.commandFor(agent);
  const configuredAgentArgs = config.argsFor(agent);

  const result = spawnSync(command, [...configuredAgentArgs, ...agentArgs], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(`Failed to start ${agent} using command "${command}".`);
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

async function activeSpecDir(input) {
  const base = join(process.cwd(), "specs");
  if (!existsSync(base)) return join(base, `${todayStamp()}-${slugify(input)}`);

  const entries = await readdir(base);
  const dirs = [];
  for (const entry of entries) {
    const fullPath = join(base, entry);
    if ((await stat(fullPath)).isDirectory()) dirs.push(fullPath);
  }
  dirs.sort();

  if (dirs.length > 0) return dirs[dirs.length - 1];
  return join(base, `${todayStamp()}-${slugify(input)}`);
}

async function writeWorkflowFile(dir, name, input = "") {
  const filename = `${name}.md`;
  const template = WORKFLOW_TEMPLATES[name] || `# ${name}\n\n{{input}}\n`;
  const content = template.replaceAll("{{input}}", input || "TBD");
  const file = join(dir, filename);
  await mkdir(dir, { recursive: true });
  await writeFile(file, content);
  console.log(`Wrote ${file}`);
}

async function buildImplementationPrompt(dir, input = "") {
  const config = await loadConfig();
  const files = [
    [".openadk/memory/constitution.md", "Team Constitution"],
    [".openadk/memory/coding.md", "Coding Guidance"],
    [".openadk/memory/quality.md", "Quality Guidance"],
    [".openadk/memory/language.md", "Language Guidance"],
    [`.openadk/presets/${config.preset}.md`, "Preset Guidance"],
    [join(dir, "spec.md"), "Feature Spec"],
    [join(dir, "plan.md"), "Implementation Plan"],
    [join(dir, "tasks.md"), "Tasks"]
  ];
  const sections = [];
  for (const [file, title] of files) {
    const content = await readMaybe(resolve(file));
    if (content.trim()) sections.push(`## ${title}\n\n${content.trim()}`);
  }
  return `# OpenADK Agent Implementation Prompt

You are executing an OpenADK SDD implementation task.

Follow the spec, plan, and tasks. Keep changes scoped. Add or update tests where practical. At the end, report commands run, files changed, and residual risks.

## Active Configuration

- Agent: ${config.defaultAgent}
- Language: ${config.language}
- Preset: ${config.preset}

## Extra Request

${input || "No extra request."}

${sections.join("\n\n")}
`;
}

async function buildSddGenerationPrompt(dir, input = "") {
  const config = await loadConfig();
  const files = [
    [".openadk/memory/constitution.md", "Team Constitution"],
    [".openadk/memory/coding.md", "Coding Guidance"],
    [".openadk/memory/quality.md", "Quality Guidance"],
    [".openadk/memory/language.md", "Language Guidance"],
    [`.openadk/presets/${config.preset}.md`, "Preset Guidance"]
  ];
  const sections = [];
  for (const [file, title] of files) {
    const content = await readMaybe(resolve(file));
    if (content.trim()) sections.push(`## ${title}\n\n${content.trim()}`);
  }
  return `# OpenADK SDD Generation Prompt

You are generating high-quality Spec Driven Development artifacts for the current repository.

## Requirement

${input || "No requirement provided."}

## Active Configuration

- Agent: ${config.defaultAgent}
- Language: ${config.language}
- Preset: ${config.preset}

## Output Files To Overwrite

Overwrite these files with complete, repository-aware content:

- ${join(dir, "brainstorm.md")}
- ${join(dir, "spec.md")}
- ${join(dir, "plan.md")}
- ${join(dir, "tasks.md")}

## Artifact Requirements

1. \`brainstorm.md\`: explain the problem, goals, constraints, candidate approaches, and recommendation.
2. \`spec.md\`: include scope, non-goals, user stories, functional requirements, non-functional requirements, edge cases, acceptance criteria, and open questions.
3. \`plan.md\`: inspect the repository and describe current architecture, proposed changes, files to touch, data/API contract changes, risks, and validation plan.
4. \`tasks.md\`: produce ordered, atomic tasks with checkboxes. Include implementation, tests, and docs/reporting tasks.

Do not implement code in this step. Only update the SDD artifacts. Keep assumptions explicit when information is missing.

${sections.join("\n\n")}
`;
}

async function buildSdtGenerationPrompt(dir, input = "") {
  const config = await loadConfig();
  const files = [
    [".openadk/memory/constitution.md", "Team Constitution"],
    [".openadk/memory/quality.md", "Quality Guidance"],
    [".openadk/memory/language.md", "Language Guidance"],
    [`.openadk/presets/${config.preset}.md`, "Preset Guidance"],
    [join(dir, "spec.md"), "Feature Spec"],
    [join(dir, "plan.md"), "Implementation Plan"],
    [join(dir, "tasks.md"), "Tasks"],
    [join(dir, "test-analysis.md"), "Current Test Analysis"],
    [join(dir, "test-cases.md"), "Current Test Cases"],
    [join(dir, "test-run.md"), "Current Test Run"],
    [join(dir, "test-report.md"), "Current Test Report"]
  ];
  const sections = [];
  for (const [file, title] of files) {
    const content = await readMaybe(resolve(file));
    if (content.trim()) sections.push(`## ${title}\n\n${content.trim()}`);
  }
  return `# OpenADK SDT Generation Prompt

You are generating high-quality Spec Driven Testing artifacts for the current repository.

## Extra Request

${input || "No extra request."}

## Active Configuration

- Agent: ${config.defaultAgent}
- Language: ${config.language}
- Preset: ${config.preset}

## Output Files To Overwrite

Overwrite these files with complete, repository-aware content:

- ${join(dir, "test-analysis.md")}
- ${join(dir, "test-cases.md")}
- ${join(dir, "test-run.md")}
- ${join(dir, "test-report.md")}

## Artifact Requirements

1. \`test-analysis.md\`: identify risk areas, boundaries, dependencies, and suggested coverage based on the SDD artifacts and current code.
2. \`test-cases.md\`: write concrete test cases with IDs, scenario, steps, expected result, and priority.
3. \`test-run.md\`: propose the exact local test commands to run. If no command can be inferred, say what is missing.
4. \`test-report.md\`: prepare a report structure with expected coverage and residual risks. Do not claim tests passed unless evidence exists.

Do not implement product code in this step. Only update SDT artifacts.

${sections.join("\n\n")}
`;
}

function detectTestCommand(agentArgs = []) {
  if (agentArgs.length > 0) return agentArgs;
  if (existsSync(resolve("package.json"))) return ["npm", "test"];
  if (existsSync(resolve("pyproject.toml")) || existsSync(resolve("pytest.ini"))) return ["python", "-m", "pytest"];
  if (existsSync(resolve("go.mod"))) return ["go", "test", "./..."];
  if (existsSync(resolve("Cargo.toml"))) return ["cargo", "test"];
  return null;
}

function truncateText(text, max = 12000) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

async function writeTestResults(dir, command, result) {
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combined = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
  const statusText = result.status === 0 ? "Passed" : "Failed";
  const now = new Date().toISOString();
  const testRun = `# Test Run

## Command

\`\`\`bash
${command.join(" ")}
\`\`\`

## Result

- Status: ${statusText}
- Exit code: ${result.status ?? "unknown"}
- Finished at: ${now}

## Output

\`\`\`text
${truncateText(combined) || "(no output)"}
\`\`\`
`;
  const testReport = `# Test Report

## Summary

- Test command: \`${command.join(" ")}\`
- Result: ${statusText}
- Exit code: ${result.status ?? "unknown"}

## Passing Cases

${result.status === 0 ? "- Automated test command completed successfully." : "- None confirmed by this run."}

## Failing Cases

${result.status === 0 ? "- None." : "- Automated test command failed. See test output in \\`test-run.md\\`."}

## Coverage Gaps

- Review \`test-cases.md\` against the command output to confirm all intended cases are covered.

## Residual Risks

- This report is based on the local command output only.

## Release Recommendation

${result.status === 0 ? "- Recommend release for the tested scope." : "- Do not release until failing tests are addressed."}
`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "test-run.md"), testRun);
  await writeFile(join(dir, "test-report.md"), testReport);
  console.log(`Wrote ${join(dir, "test-run.md")}`);
  console.log(`Wrote ${join(dir, "test-report.md")}`);
}

async function runTestsAndWriteReport(args, dir) {
  const { agentArgs } = splitOwnAndAgentArgs(args);
  const command = detectTestCommand(agentArgs);
  if (!command) {
    console.error("Could not infer a test command. Provide one after --, for example: openadk sdt run -- npm test");
    process.exit(1);
  }
  const [cmd, ...cmdArgs] = command;
  const result = spawnSync(cmd, cmdArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
  if (result.error) {
    const failed = {
      status: 1,
      stdout: result.stdout || "",
      stderr: result.error.message
    };
    await writeTestResults(dir, command, failed);
    process.exit(1);
  }
  await writeTestResults(dir, command, result);
  process.exit(result.status ?? 1);
}

async function executeTestsAndWriteReport(args, dir) {
  const { agentArgs } = splitOwnAndAgentArgs(args);
  const command = detectTestCommand(agentArgs);
  if (!command) {
    console.error("Could not infer a test command. Provide one after --, for example: openadk sdt run -- npm test");
    return 1;
  }
  const [cmd, ...cmdArgs] = command;
  const result = spawnSync(cmd, cmdArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
  if (result.error) {
    const failed = {
      status: 1,
      stdout: result.stdout || "",
      stderr: result.error.message
    };
    await writeTestResults(dir, command, failed);
    return 1;
  }
  await writeTestResults(dir, command, result);
  return result.status ?? 1;
}

async function runAgentPrompt(args, prompt) {
  const { ownArgs, agentArgs } = splitOwnAndAgentArgs(args);
  const config = await loadConfig();
  const agent = parseFlag(ownArgs, "--agent", config.defaultAgent);
  validateChoice("agent", agent, AGENTS);
  const command = config.commandFor(agent);
  const configuredAgentArgs = config.argsFor(agent);
  const invocation = agentRunInvocation(agent, command, [...configuredAgentArgs, ...agentArgs]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    shell: false
  });
  if (result.error) {
    console.error(`Failed to run ${agent} using command "${invocation.command}".`);
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 0;
}

async function maybeRunAgent(args, prompt) {
  if (!hasFlag(args, "--run")) return;
  process.exit(await runAgentPrompt(args, prompt));
}

async function runSdd(args) {
  const step = args[0];
  if (!step) {
    console.error("Missing SDD step. Try: openadk sdd ff \"your requirement\"");
    process.exit(1);
  }

  const input = commandText(args.slice(1));
  const dir = await activeSpecDir(input || step);

  if (step === "ff") {
    await writeWorkflowFile(dir, "brainstorm", input);
    await writeWorkflowFile(dir, "spec", input);
    await writeWorkflowFile(dir, "plan", input);
    await writeWorkflowFile(dir, "tasks", input);
    if (hasFlag(args, "--run")) {
      const prompt = await buildSddGenerationPrompt(dir, input);
      const file = join(dir, "sdd-generation-prompt.md");
      await writeFile(file, prompt);
      console.log(`Wrote ${file}`);
      await maybeRunAgent(args, prompt);
    }
    return;
  }

  const map = {
    brainstorm: "brainstorm",
    specify: "spec",
    plan: "plan",
    tasks: "tasks",
    implement: "implement-prompt",
    review: "review",
    archive: "archive"
  };
  const name = map[step];
  if (!name) {
    console.error(`Unknown SDD step: ${step}`);
    process.exit(1);
  }
  if (step === "implement") {
    const prompt = await buildImplementationPrompt(dir, input);
    const file = join(dir, "implement-prompt.md");
    await mkdir(dir, { recursive: true });
    await writeFile(file, prompt);
    console.log(`Wrote ${file}`);
    await maybeRunAgent(args, prompt);
    return;
  }
  await writeWorkflowFile(dir, name, input);
}

async function runSdt(args) {
  const step = args[0];
  if (!step) {
    console.error("Missing SDT step. Try: openadk sdt ff");
    process.exit(1);
  }

  const input = commandText(args.slice(1));
  const dir = await activeSpecDir(input || step);

  if (step === "ff") {
    await writeWorkflowFile(dir, "test-analysis", input);
    await writeWorkflowFile(dir, "test-cases", input);
    await writeWorkflowFile(dir, "test-run", input);
    await writeWorkflowFile(dir, "test-report", input);
    if (hasFlag(args, "--run")) {
      const prompt = await buildSdtGenerationPrompt(dir, input);
      const file = join(dir, "sdt-generation-prompt.md");
      await writeFile(file, prompt);
      console.log(`Wrote ${file}`);
      await maybeRunAgent(args, prompt);
    }
    return;
  }

  if (step === "run") {
    await runTestsAndWriteReport(args, dir);
    return;
  }

  const map = {
    analyze: "test-analysis",
    cases: "test-cases",
    report: "test-report"
  };
  const name = map[step];
  if (!name) {
    console.error(`Unknown SDT step: ${step}`);
    process.exit(1);
  }
  await writeWorkflowFile(dir, name, input);
}

async function runFullWorkflow(args) {
  const input = commandText(args);
  if (!input) {
    console.error("Missing requirement. Try: openadk run \"add a /version endpoint\"");
    process.exit(1);
  }

  const dir = await activeSpecDir(input);
  console.log(`OpenADK run started: ${input}`);
  console.log(`Spec directory: ${dir}`);

  await writeWorkflowFile(dir, "brainstorm", input);
  await writeWorkflowFile(dir, "spec", input);
  await writeWorkflowFile(dir, "plan", input);
  await writeWorkflowFile(dir, "tasks", input);
  const sddPrompt = await buildSddGenerationPrompt(dir, input);
  await writeFile(join(dir, "sdd-generation-prompt.md"), sddPrompt);
  console.log("Running agent for SDD generation...");
  let status = await runAgentPrompt(args, sddPrompt);
  if (status !== 0) process.exit(status);

  const implementPrompt = await buildImplementationPrompt(dir, "");
  await writeFile(join(dir, "implement-prompt.md"), implementPrompt);
  console.log("Running agent for implementation...");
  status = await runAgentPrompt(args, implementPrompt);
  if (status !== 0) process.exit(status);

  await writeWorkflowFile(dir, "test-analysis", "");
  await writeWorkflowFile(dir, "test-cases", "");
  await writeWorkflowFile(dir, "test-run", "");
  await writeWorkflowFile(dir, "test-report", "");
  const sdtPrompt = await buildSdtGenerationPrompt(dir, "");
  await writeFile(join(dir, "sdt-generation-prompt.md"), sdtPrompt);
  console.log("Running agent for SDT generation...");
  status = await runAgentPrompt(args, sdtPrompt);
  if (status !== 0) process.exit(status);

  if (hasFlag(args, "--no-test")) {
    console.log(`OpenADK run completed without local tests. Artifacts: ${dir}`);
    return;
  }

  console.log("Running local tests...");
  status = await executeTestsAndWriteReport([], dir);
  console.log(`OpenADK run completed. Artifacts: ${dir}`);
  process.exit(status);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }
  if (command === "-v" || command === "--version") {
    console.log(VERSION);
    return;
  }
  if (command === "init") return initProject(args);
  if (command === "config") return configureProject(args);
  if (command === "presets") return listPresets();
  if (command === "code") return runCode(args);
  if (command === "run") return runFullWorkflow(args);
  if (command === "sdd") return runSdd(args);
  if (command === "sdt") return runSdt(args);

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
