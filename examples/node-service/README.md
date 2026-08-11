# Node Service Demo

This is a tiny service for demonstrating the OpenADK workflow.

Try:

```bash
node ../../src/cli.js init --agent codex --language javascript --preset backend --yes
node ../../src/cli.js sdd ff "add a /version endpoint that returns the package version"
node ../../src/cli.js sdd implement "keep the API response JSON-only"
node ../../src/cli.js sdt ff
npm test
```

The goal is to show the full loop:

1. Initialize project memory and preset guidance.
2. Generate SDD artifacts.
3. Generate an Agent-ready implementation prompt.
4. Generate SDT artifacts.
5. Verify the service with tests.
