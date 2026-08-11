# Backend Preset

## Focus Areas

- API contracts and backward compatibility.
- Data model and migration safety.
- Error handling, observability, retries, and idempotency.
- Unit, integration, and smoke tests.

## SDD Notes

- Include request/response contracts in `plan.md`.
- Call out persistence, cache, queue, and external service dependencies.
- Make rollout and rollback assumptions explicit.

## SDT Notes

- Cover happy paths, invalid input, dependency failure, and concurrency-sensitive cases.
