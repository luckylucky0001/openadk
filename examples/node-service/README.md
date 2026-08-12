# Node Service Demo

This is a tiny service for demonstrating the OpenADK workflow.

Try:

```bash
node ../../src/cli.js start --yes
node ../../src/cli.js spec init "add a /version endpoint that returns the package version"
node ../../src/cli.js spec status
node ../../src/cli.js spec check
npm test
```

The goal is to show the full loop:

1. Adopt the project and launch the native Agent.
2. Create one canonical draft Spec.
3. Complete requirements, design, decisions, and tasks with the Agent.
4. Advance only through passing gates.
5. Record verification evidence and archive an integrity-bound export.
