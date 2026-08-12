# Release Checklist

## Before Publishing

- Confirm `npm test` passes.
- Run `node ./src/cli.js --help`.
- Run `node ./src/cli.js presets`.
- Smoke test `start`, `spec init`, `project protect`, `verify run`, `spec check`, `spec recover`, `doctor`, and `audit repo` in a temporary directory.
- Review README examples.
- Review `examples/node-service`.

## npm Package

Suggested package fields before first public publish:

- `repository`
- `bugs`
- `homepage`
- `files`
- final package name availability

## Versioning

Use SemVer:

- Patch: docs, preset wording, bug fixes.
- Minor: new commands, new presets, new agent adapters.
- Major: breaking workflow or config changes.

## First Announcement

Positioning:

> OpenADK is a local, agent-native workflow layer that turns requirements, decisions, implementation tasks, and verification evidence into one reviewable Spec lifecycle.
