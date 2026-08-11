# Release Checklist

## Before Publishing

- Confirm `npm test` passes.
- Run `node ./src/cli.js --help`.
- Run `node ./src/cli.js presets`.
- Smoke test `init`, `sdd ff`, `sdd implement`, and `sdt ff` in a temporary directory.
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

> OpenADK is a workflow layer for reliable AI-assisted software delivery. It brings SDD and SDT to existing coding agents such as Codex, OpenCode, and Cursor.
