# OpenADK Work Summary

## Background

This project started from studying TTADK's initialization flow: choose an AI tool, choose a language, then choose a preset such as backend, frontend, mobile, fullstack, or common.

We used that product shape as inspiration, but scoped the first open-source version around a smaller and more portable goal:

- support existing coding CLIs such as Codex, OpenCode, and Cursor;
- turn one-line requirements into reviewable SDD artifacts;
- connect SDD to implementation;
- connect implementation to SDT and real test execution;
- keep the workflow independent from any single model or agent.

The result is OpenADK, a lightweight workflow layer for reliable AI-assisted software delivery.

## What We Built

OpenADK is implemented as a dependency-free Node.js CLI.

The package exposes one executable:

```bash
openadk
```

During local development it can also be run directly:

```bash
node ./src/cli.js
```

The current MVP includes these command families:

```bash
openadk init
openadk config
openadk presets
openadk code
openadk run
openadk sdd
openadk sdt
```

## Initialization Model

OpenADK follows three setup choices:

- Agent: which CLI executes the work, such as Codex, OpenCode, or Cursor.
- Language: which language conventions should shape implementation and testing.
- Preset: which domain knowledge pack should guide the agent.

Example:

```bash
openadk init --agent codex --language typescript --preset backend
```

This creates a project-local `.openadk/` directory with:

```text
.openadk/config.yaml
.openadk/memory/*.md
.openadk/presets/<preset>.md
docs/
specs/
```

The config stores the default agent, language, preset, and agent command settings:

```yaml
defaultAgent: codex
language: typescript
preset: backend
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
```

## Centralized Agent And Model Config

We removed the need to pass `--agent codex` repeatedly.

The default agent is configured once:

```bash
openadk config --agent codex
```

Model and agent flags can also be centralized:

```bash
openadk config --model gpt-5.5
```

This writes:

```yaml
agents:
  codex:
    command: codex
    args: ["--model", "gpt-5.5"]
```

For custom flags:

```bash
openadk config --agent-args "--model gpt-5 --reasoning high"
```

After that, SDD, implementation, SDT, and `openadk code` all reuse the configured agent arguments automatically.

## SDD: Spec Driven Development

OpenADK can create the core SDD artifacts:

```bash
openadk sdd ff "add a /version endpoint"
```

This creates:

```text
specs/<date>-add-a-version-endpoint/
  brainstorm.md
  spec.md
  plan.md
  tasks.md
```

The first version of these files is a starter scaffold. With `--run`, OpenADK asks the configured agent to inspect the repository and overwrite those files with richer, repository-aware content:

```bash
openadk sdd ff --run "add a /version endpoint"
```

The generated prompt is saved as:

```text
sdd-generation-prompt.md
```

That file makes the generation auditable. The team can review what the agent was asked to do, not just the final output.

## Implementation From SDD

Once `spec.md`, `plan.md`, and `tasks.md` exist, OpenADK can build an implementation prompt:

```bash
openadk sdd implement
```

This writes:

```text
implement-prompt.md
```

With `--run`, OpenADK pipes that prompt into the configured agent:

```bash
openadk sdd implement --run
```

For Codex, OpenADK uses the non-interactive execution surface:

```bash
codex exec -
```

OpenADK automatically adds safe defaults for this flow:

```bash
--skip-git-repo-check --ephemeral --sandbox workspace-write -C <current directory>
```

This avoids the `stdin is not a terminal` failure that happens when trying to drive the interactive `codex` command from a non-interactive process.

## SDT: Spec Driven Testing

OpenADK also creates testing artifacts:

```bash
openadk sdt ff
```

This creates:

```text
test-analysis.md
test-cases.md
test-run.md
test-report.md
```

With `--run`, the configured agent completes the SDT artifacts based on the SDD docs and current repository state:

```bash
openadk sdt ff --run
```

The generated prompt is saved as:

```text
sdt-generation-prompt.md
```

OpenADK can then run the local test command and write real results into the SDT report:

```bash
openadk sdt run
```

It auto-detects common project types:

- `package.json` -> `npm test`
- `pyproject.toml` or `pytest.ini` -> `python -m pytest`
- `go.mod` -> `go test ./...`
- `Cargo.toml` -> `cargo test`

The test command can also be specified explicitly:

```bash
openadk sdt run -- npm test
```

## One-Command Full Workflow

The newest workflow is:

```bash
openadk run "add a /version endpoint"
```

This runs the full chain:

```text
one-line requirement
-> starter SDD artifacts
-> agent-generated SDD artifacts
-> implementation prompt
-> agent implementation
-> starter SDT artifacts
-> agent-generated SDT artifacts
-> local test execution
-> test-run.md and test-report.md
```

For demos or dry runs where local tests should not execute:

```bash
openadk run --no-test "add a /version endpoint"
```

This makes the project much easier to explain: a customer can see how one sentence becomes structured engineering artifacts, code changes, and a test report.

## Presets

The initial preset set is intentionally similar to TTADK's product framing:

- `backend`: API, data, reliability, and integration guidance.
- `frontend`: UX states, accessibility, responsive UI, and component guidance.
- `mobile`: platform lifecycle, network, permissions, and release safety.
- `fullstack`: API contracts, frontend/backend split, and end-to-end flow.
- `common`: general tools, libraries, scripts, and mixed repositories.

Presets are plain Markdown files in:

```text
presets/*.md
```

During `init`, the selected preset is copied into:

```text
.openadk/presets/<preset>.md
```

This keeps presets inspectable and editable. Teams can fork them, customize them, and eventually share organization-specific knowledge packs.

## Demo Repo

We built and used a real demo under:

```text
work/full-run-node-service
```

The demo requirement was:

```text
add a /version endpoint
```

The service is a small Node.js HTTP server. The expected behavior is:

- `/health` returns `{ "ok": true }`
- `/version` returns `{ "version": packageJson.version }`
- unknown routes return a JSON 404 response

The SDD and SDT artifacts were generated in:

```text
work/full-run-node-service/specs/20260714-add-a-version-endpoint-that-returns-the-package-ve/
```

The final `test-report.md` recorded:

- `npm test` passed;
- `/health` was tested;
- `/version` was tested;
- unknown routes were tested;
- manual live smoke testing was blocked in the sandbox due to port binding restrictions.

## Automated Test Coverage

The OpenADK CLI has smoke tests in:

```text
test/cli-smoke.test.js
```

The tests cover:

- help output;
- preset listing;
- project-level agent config;
- model config written into `.openadk/config.yaml`;
- Codex non-interactive invocation through `codex exec`;
- SDD agent prompt generation;
- SDT agent prompt generation;
- full `openadk run --no-test` workflow;
- local SDT test execution and report writing;
- init, SDD, and SDT artifact creation.

The latest verification result:

```text
npm test
9 tests passed, 0 failed
```

Package dry-run also passed:

```text
npm pack --dry-run
package includes 17 files
```

## Why This Matters

OpenADK is not trying to replace coding agents.

It sits above them and provides a repeatable workflow:

- SDD gives the agent clear requirements, scope, architecture context, and tasks.
- Implementation happens against explicit artifacts rather than a vague chat thread.
- SDT makes testing strategy and evidence part of the workflow.
- The configured agent can change without rewriting the process.

This gives us a useful customer narrative:

> Better AI coding is not only about a stronger model. It is about better context, better constraints, better validation, and reusable team memory.

## Current Boundaries

The project is still an MVP.

Known boundaries:

- The config parser is intentionally lightweight and supports the YAML shape OpenADK writes itself.
- Agent adapters are basic. Codex has the most complete non-interactive path today.
- `openadk run` auto-detects the local test command, but does not yet support a separate test-command flag.
- Presets are useful but still early; they need more real-world examples.
- The demo is intentionally small and should be expanded with more realistic frontend, backend, and fullstack cases.

## Recommended Next Steps

Suggested next work:

1. Add `openadk status` to show current agent, language, preset, active spec, SDD state, SDT state, and latest test result.
2. Add richer demo walkthrough docs for the `/version` endpoint.
3. Add more presets such as `cli-tool`, `library`, `backend-api`, and `frontend-web`.
4. Make agent adapters more explicit, especially for OpenCode and Cursor.
5. Add a clean way for `openadk run` to accept a custom test command.
6. Package and publish an initial npm prerelease for internal testing.

