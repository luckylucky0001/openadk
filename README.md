# OpenADK

OpenADK is a local, agent-native workflow layer for reliable AI-assisted software delivery.

It brings one deterministic Spec lifecycle to Codex, OpenCode, Claude Code, and Cursor Agent.

## Why

AI agents can write code quickly, but teams still need clear requirements, technical boundaries, validation plans, and reusable engineering knowledge.

OpenADK turns ad-hoc AI coding conversations into reviewable, testable, and repeatable engineering workflows.

## Install

```bash
npm install -g openadk
```

For local development:

```bash
npm link
openadk --help
```

## Quick Start

```bash
cd your-project
openadk start
```

Then tell the Agent what you want to build, for example: "Create a Spec for passwordless login." OpenADK installs a project-native Orchestrator Skill so the Agent can use the local Spec engine through natural language.

For a deterministic CLI-only flow:

```bash
openadk spec init "add passwordless login"
openadk spec status
openadk spec check
openadk spec advance
```

`openadk start` prepares the project on first use and launches the configured native Agent. It does not fetch, pull, push, publish, sync, or update remote content. Use `--no-launch` when you only want to prepare project assets.

This creates project method and evidence assets:

```text
.openadk/
.agents/skills/openadk-orchestrator/
.claude/skills/openadk-orchestrator/
.cursor/skills/openadk-orchestrator/
.opencode/skills/openadk-orchestrator/
docs/
specs/
```

An existing non-empty project asks for one onboarding confirmation before these local assets are written. OpenADK records their version and integrity in `.openadk/project-pin.json`; startup reports upgrades but never adopts them implicitly.

Each stateful Spec contains:

- `requirements.md`
- `design.md`
- `decisions.md`
- `tasks.md`
- `verification.md`
- `receipts/*.json` after OpenADK executes verification commands
- `spec-state.json`
- `export.md` after an explicit export

The state engine only permits adjacent transitions:

```text
draft -> specified -> planned -> tasked -> implementing -> verified -> archived
```

Every transition validates the artifacts needed for the next phase. Requirements use `FR-###` and `AC-###`; decisions, tasks, and verification use `D-###`, `T-###`, and `V-###` so reviewers can trace promises to implementation and evidence. Entering `verified` also requires successful OpenADK receipts for both the normal test suite and a separate adversarial command, with every AC covered.

## Commands

```bash
openadk start [--no-launch] [--yes] [-- ...agentArgs]
openadk init [--agent codex|opencode|claude|cursor] [--language typescript] [--preset backend] [--yes]
openadk config [--agent codex|opencode|claude|cursor] [--language typescript] [--preset backend] [--model gpt-5]
openadk presets
openadk code [--agent codex|opencode|claude|cursor|-t codex] [-- ...agentArgs]
openadk spec <init|status|check|advance|export|recover --yes> [title|phase] [--id spec-id]
openadk verify run --kind <test|adversarial|static> --covers AC-001[,AC-002] -- <command> [args]
openadk project <status|protect [status|files...]>
openadk project upgrade <status|apply --yes|recover --yes>
openadk doctor [--json]
openadk audit repo
```

`openadk init --agent codex` stores the default Agent in `.openadk/config.yaml`. `openadk start` and `openadk code` use that project-level default automatically.

Protect files that a Spec must not change before implementation, then run verification through OpenADK so the gate receives machine evidence rather than copied terminal text:

```bash
openadk project protect README.md package.json
openadk verify run --kind test --covers AC-001,AC-002 -- npm test
openadk verify run --kind adversarial --covers AC-001,AC-002 -- node --test test/adversarial.test.js
```

Verification commands are executed directly without a shell. Receipts retain the exact argv, exit status, duration, and stdout/stderr hashes, but not the raw output. If Spec state is damaged, `openadk spec recover --yes` restores the latest valid OpenADK snapshot.

| Agent value | Native command | Project-native method path |
| --- | --- | --- |
| `codex` | `codex` | `.agents/skills/openadk-orchestrator/` |
| `opencode` | `opencode` | `.opencode/skills/openadk-orchestrator/` |
| `claude` | `claude` | `.claude/skills/openadk-orchestrator/` |
| `cursor` | `cursor-agent` | `.cursor/skills/openadk-orchestrator/` |

To change the default later:

```bash
openadk config --agent codex --model gpt-5
openadk config --agent opencode
openadk config --agent claude
openadk config --agent cursor
```

`openadk config --model gpt-5` stores default Agent arguments in `.openadk/config.yaml`, so later `openadk start` and `openadk code` calls reuse the same model choice. For custom Agent flags, use:

```bash
openadk config --agent-args "--model gpt-5 --reasoning high"
```

The project-native Orchestrator guides the Agent through requirements, design, decisions, tasks, implementation, verification, export, and archive. The Agent uses `openadk spec check` and `openadk spec advance`; there is no parallel legacy command model.

## Initialization Choices

OpenADK follows three setup choices:

- **Agent**: who executes the task: Codex, OpenCode, Claude Code, or Cursor Agent.
- **Language**: which language conventions should shape plans and tests.
- **Preset**: which domain knowledge pack should be installed.

```bash
openadk presets
openadk init --agent codex --language go --preset backend
```

Initial presets:

- `backend`: API, data, reliability, and integration guidance.
- `frontend`: UX states, accessibility, responsive UI, and component guidance.
- `mobile`: platform lifecycle, network, permissions, and release safety.
- `fullstack`: API contracts, frontend/backend split, and end-to-end flow.
- `common`: general tools, libraries, scripts, and mixed repositories.

Packaged presets live in `presets/*.md`, so teams can review, fork, and contribute them as plain Markdown.

## Demo

See [examples/node-service](examples/node-service) for a tiny backend service that demonstrates the workflow against a real project.

For a complete end-to-end scenario, see [CI 日志安全脱敏案例](docs/ci-log-redaction-quickstart.md). It covers requirement clarification, gate failures, FR/AC/D/T/V traceability, streaming and security verification, multi-Agent handoff, export, and archive.

## Core Idea

Better AI coding is not only about better models. It is about better context, better constraints, better tests, and better team memory.

## Project Status

OpenADK is an early open-source release focused on a small, auditable local core:

- one canonical Spec and evidence model,
- deterministic adjacent-phase gates,
- project-native Agent methods,
- explicit project adoption and method upgrades,
- local-only safety, recovery, and repository audits.
