# OpenADK

OpenADK is a workflow layer for reliable AI-assisted software delivery.

It brings **Spec Driven Development** and **Spec Driven Testing** to existing AI coding CLIs such as Codex, OpenCode, and Cursor.

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
openadk init --agent codex --language typescript --preset backend
openadk config --model gpt-5
openadk run "add passwordless login"
```

This creates:

```text
.openadk/
docs/
specs/
```

The `specs/` directory holds the reviewable workflow artifacts:

- `brainstorm.md`
- `spec.md`
- `plan.md`
- `tasks.md`
- `test-analysis.md`
- `test-cases.md`
- `test-run.md`
- `test-report.md`

## Commands

```bash
openadk init [--agent codex|opencode|cursor] [--language typescript] [--preset backend] [--yes]
openadk config [--agent codex|opencode|cursor] [--language typescript] [--preset backend] [--model gpt-5]
openadk presets
openadk code [--agent codex|opencode|cursor|-t codex] [-- ...agentArgs]
openadk run [--agent codex] [--no-test] "requirement" [-- ...agentArgs]
openadk sdd <brainstorm|specify|plan|tasks|implement|ff|review|archive> [--agent codex] [--run] [text]
openadk sdt <analyze|cases|run|report|ff> [--agent codex] [--run] [text]
```

`openadk init --agent codex` stores the default agent in `.openadk/config.yaml`. Later SDD and SDT commands use that project-level default automatically, so `--agent` is only needed when you want a one-off override.

To change the default later:

```bash
openadk config --agent codex --model gpt-5
openadk config --agent opencode
openadk config --agent cursor
```

`openadk config --model gpt-5` stores default agent arguments in `.openadk/config.yaml`, so later SDD, SDT, implementation, and `openadk code` calls reuse the same model choice. For custom agent flags, use:

```bash
openadk config --agent-args "--model gpt-5 --reasoning high"
```

`openadk run` is the full automated path. It creates starter SDD artifacts, asks the selected Agent to complete them, asks the Agent to implement, creates SDT artifacts, asks the Agent to complete the testing guidance, then runs local tests and writes the real result into `test-run.md` and `test-report.md`.

```bash
openadk run "add passwordless login"
openadk run --no-test "add passwordless login"
openadk run "add passwordless login" -- --model gpt-5.5
```

`openadk sdd ff` writes starter SDD artifacts. Add `--run` to ask the selected Agent to inspect the repository and overwrite `brainstorm.md`, `spec.md`, `plan.md`, and `tasks.md` with complete content:

```bash
openadk sdd ff --run "add passwordless login"
```

`openadk sdd implement` writes an Agent-ready `implement-prompt.md`. Add `--run` to pipe that prompt into the selected Agent CLI:

```bash
openadk sdd implement --run -- --model gpt-5
```

For Codex, OpenADK uses `codex exec -` under the hood because the interactive `codex` command requires a terminal. It defaults to `--ephemeral --sandbox workspace-write -C <current directory>` so the Agent can update files in the active project. You can override Codex flags after `--`.

`openadk sdt ff` writes starter SDT artifacts. Add `--run` to ask the selected Agent to inspect the repository and overwrite `test-analysis.md`, `test-cases.md`, `test-run.md`, and `test-report.md` with complete testing guidance:

```bash
openadk sdt ff --run
```

`openadk sdt run` executes the local test command and writes the real command output into `test-run.md` and `test-report.md`. It auto-detects common project types such as `package.json`, `pyproject.toml`, `go.mod`, and `Cargo.toml`.

```bash
openadk sdt run
openadk sdt run -- npm test
```

## Initialization Choices

OpenADK follows three setup choices:

- **Agent**: who executes the task, such as Codex, OpenCode, or Cursor CLI.
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

## Core Idea

Better AI coding is not only about better models. It is about better context, better constraints, better tests, and better team memory.

## Project Status

This repository is an early MVP. The first goal is to make the workflow tangible and easy to discuss:

- one command to initialize team memory,
- one command family for SDD,
- one command family for SDT,
- one adapter layer for existing AI coding CLIs.
