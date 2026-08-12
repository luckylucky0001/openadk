#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { AGENTS, defaultAgentCommand } from "./agents.js";
import { adoptProject, inspectProject, recoverProjectAssets } from "./project-assets.js";
import { runAuditCommand, runDoctorCommand, runProjectCommand, runSpecCommand, runVerifyCommand } from "./commands.js";

const VERSION = "0.4.0";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
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


function printHelp() {
  console.log(`OpenADK ${VERSION}

A workflow layer for reliable AI-assisted software delivery.

Usage:
  openadk start [--no-launch] [--yes] [-- ...agentArgs]
  openadk init [--agent codex|opencode|claude|cursor] [--language typescript] [--preset backend] [--yes]
  openadk config [--agent codex|opencode|claude|cursor] [--language typescript] [--preset backend] [--model gpt-5]
  openadk presets
  openadk code [--agent codex|opencode|claude|cursor|-t codex] [-- ...agentArgs]
  openadk spec <init|status|check|advance|export|recover --yes> [title|phase] [--id spec-id]
  openadk verify run --kind <test|adversarial|static> --covers AC-001[,AC-002] -- <command> [args]
  openadk project <status|protect [status|files...]|upgrade status|upgrade apply --yes|upgrade recover --yes>
  openadk doctor [--json]
  openadk audit repo

Examples:
  openadk start
  openadk spec init "add passwordless login"
  openadk spec check
  openadk spec advance
  openadk verify run --kind test --covers AC-001 -- npm test
  openadk init --agent codex --language typescript --preset backend
  openadk config --agent codex --model gpt-5
  openadk init
  openadk presets
  openadk code
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
  await adoptProject(cwd, { confirmed: true });
}

async function startProject(args) {
  const cwd = process.cwd();
  const inspection = await inspectProject(cwd);
  if (inspection.state === "recovery-required") {
    console.log("Recovering an interrupted OpenADK project asset transaction...");
    await recoverProjectAssets(cwd);
    return startProject(args);
  }
  if (inspection.state === "blocked") {
    console.error("OpenADK project is blocked:");
    for (const reason of inspection.reasons) console.error(`- ${reason}`);
    process.exit(1);
  }
  if (inspection.state === "adoption-required" && !hasFlag(args, "--yes") && !hasFlag(args, "-y")) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(`Existing project onboarding requires confirmation: ${cwd}`);
      console.error("Re-run openadk start --yes after reviewing the project path.");
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`OpenADK will add local method assets to ${cwd}. Continue? [y/N] `);
    rl.close();
    if (!/^y(?:es)?$/i.test(answer.trim())) {
      console.error("OpenADK project onboarding was cancelled; no files were changed.");
      process.exit(1);
    }
    args = [...args, "--yes"];
  }
  if (!existsSync(resolve(".openadk/config.yaml"))) {
    console.log("Preparing OpenADK project assets...");
    await initProject([...args, "--yes"]);
  }
  await adoptProject(cwd, { confirmed: hasFlag(args, "--yes") || hasFlag(args, "-y") });
  const ready = await inspectProject(cwd);
  if (ready.state === "upgrade-available") {
    console.log(`OpenADK method ${ready.methodVersion} is pinned; ${ready.targetVersion} is available. Run openadk project upgrade apply --yes to adopt it.`);
  }
  if (hasFlag(args, "--no-launch")) {
    console.log("OpenADK is ready. Agent launch skipped.");
    return;
  }
  const forwarded = args.filter((arg) => !["--yes", "-y", "--no-launch"].includes(arg));
  return runCode(forwarded);
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

## Planning Notes

- Align implementation plans with this language's package, build, and test conventions.
- Prefer existing project scripts over inventing new commands.

## Verification Notes

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
    return agentBlock(agent).match(/^\s+command:\s*(\S+)/m)?.[1] || defaultAgentCommand(agent);
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
  claude:
    command: claude
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
    return `${text.trimEnd()}\n  ${agent}:\n    command: ${defaultAgentCommand(agent)}\n${formatted}\n`;
  }
  const block = match[1];
  const nextBlock = /^\s+args:/m.test(block)
    ? block.replace(/^\s+args:\s*.*$/m, formatted)
    : `${block.trimEnd()}\n${formatted}\n`;
  return text.replace(block, nextBlock);
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
  if (command === "start") return startProject(args);
  if (command === "config") return configureProject(args);
  if (command === "presets") return listPresets();
  if (command === "code") return runCode(args);
  if (command === "spec") return runSpecCommand(args);
  if (command === "verify") return runVerifyCommand(args);
  if (command === "project") return runProjectCommand(args);
  if (command === "doctor") return runDoctorCommand(args);
  if (command === "audit") return runAuditCommand(args);

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
