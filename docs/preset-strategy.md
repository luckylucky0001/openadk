# Preset Strategy

TTADK's initialization flow separates three decisions:

- AI tool: which agent executes the work.
- Language: which programming conventions apply.
- Preset: which domain knowledge pack should be installed.

OpenADK uses the same product shape, but keeps the open-source version lightweight and vendor-neutral.

## OpenADK Choices

### Agent

The agent is the execution surface.

Initial options:

- `codex`
- `opencode`
- `cursor`

The project should not force a single agent. The workflow artifacts should stay stable even when teams swap models or tools.

### Language

The language choice controls planning and testing guidance.

Initial options:

- `javascript`
- `typescript`
- `python`
- `go`
- `java`
- `rust`
- `swift`
- `kotlin`

The language guide is written to `.openadk/memory/language.md`.

### Preset

The preset is a small knowledge pack for a development domain.

Initial options:

- `backend`
- `frontend`
- `mobile`
- `fullstack`
- `common`

The preset guide is written to `.openadk/presets/<preset>.md`.

## Why This Shape Works

This structure maps cleanly to customer conversations:

- "Which model or agent should I use?" maps to **Agent**.
- "How do we adapt to our stack?" maps to **Language**.
- "How do we capture team best practices?" maps to **Preset**.

It also gives OpenADK a natural roadmap:

1. Packaged presets as Markdown guidance in `presets/*.md`.
2. Community presets published as packages.
3. Team presets stored in repositories.
4. Enterprise presets with policy, CI, and compliance checks.

## Preset Design Rules

Good presets should be:

- Small enough to read.
- Opinionated enough to guide the agent.
- Mostly Markdown at first.
- Easy to override in a repository.
- Focused on workflow, not vendor-specific infrastructure.

Avoid making presets into a hidden framework. The point is to give the agent better context and constraints while leaving the application architecture in the user's control.

## Possible Future Presets

- `data`: ETL, analytics, notebooks, warehouse models.
- `devtools`: CLIs, build tools, repository automation.
- `security`: threat modeling, auth, secret handling, dependency review.
- `ml`: training pipelines, evaluation, inference services.
- `docs`: technical writing, API docs, migration guides.
- `infra`: IaC, deployment, observability, rollback planning.
