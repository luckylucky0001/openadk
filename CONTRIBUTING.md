# Contributing

OpenADK is early. Contributions should keep the project small, readable, and workflow-first.

## Development

```bash
npm test
node ./src/cli.js --help
```

## Presets

Presets live in `presets/*.md`.

A good preset is:

- concise,
- domain-specific,
- easy to override,
- focused on the canonical Spec lifecycle and verification evidence,
- free of vendor-specific internal assumptions.

To add a preset:

1. Add `presets/<name>.md`.
2. Add the preset name and description in `src/cli.js`.
3. Add or update tests.
4. Document the preset in `README.md`.

## Pull Request Checklist

- Tests pass with `npm test`.
- README or docs are updated for user-visible changes.
- New workflow behavior has a smoke test.
- The change does not require network access for normal use.
