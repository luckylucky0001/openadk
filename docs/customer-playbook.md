# Customer Playbook

This playbook helps explain OpenADK to customers who are evaluating language models, coding agents, and AI-assisted delivery.

## Core Message

Do not frame OpenADK as another AI coding tool. Frame it as a workflow layer for reliable AI-assisted software delivery.

The practical message:

> Better AI coding is not only about better models. It is about better context, better constraints, better tests, and better team memory.

## Talk Track

### 1. Establish the Problem

Many teams already have access to strong coding models. The problem is that real delivery needs more than one good answer in a chat window.

Common failure modes:

- Requirements are loose.
- Context is scattered.
- Agent behavior drifts during long tasks.
- Tests are added too late.
- Good prompts stay in personal history instead of becoming team practice.

### 2. Introduce the Spec Method

The OpenADK Spec Method turns a request into reviewable engineering artifacts before implementation starts.

Recommended wording:

> A Spec gives the agent a map. It defines the goal, scope, boundaries, decisions, tasks, and acceptance criteria so the agent can execute with less ambiguity.

### 3. Introduce Verification Evidence

Verification evidence makes validation a first-class part of the same Spec lifecycle.

Recommended wording:

> Verification links each acceptance criterion to tests, commands, and observed evidence before the team decides whether implementation is done.

### 4. Explain Multi-Agent Strategy

OpenADK should not be tied to one model or one coding agent.

Recommended wording:

> We keep the workflow stable while allowing teams to choose Codex, OpenCode, Claude Code, or Cursor Agent based on cost, capability, privacy, and developer preference.

### 5. Explain ROI

Avoid measuring only generated lines of code.

Better metrics:

- Time from requirement to verified implementation.
- Review issues per change.
- Rework rate.
- Test coverage and test pass rate.
- Number of reusable decisions captured in docs.
- Onboarding time for new contributors.

## Objection Handling

### "Why not just use the best model directly?"

Strong models help, but production software delivery also needs shared context, reviewable decisions, reproducible tasks, and validation evidence. OpenADK makes those parts explicit.

### "Will this slow developers down?"

The goal is not ceremony. The goal is to reduce rework. Every change uses the same Spec model, while gate depth and evidence scale with risk.

### "Does this replace our existing tools?"

No. OpenADK sits above existing CLIs and repositories. It starts by organizing workflow artifacts and invoking the agents teams already use.

## Shareable Themes

- From prompt engineering to workflow engineering.
- Why coding agents need boundaries.
- How to evaluate AI coding beyond demos.
- How a stable Spec lifecycle reduces agent drift.
- How linked evidence turns generated code into verifiable code.
- Why multi-agent teams need stable process, not one mandated tool.
