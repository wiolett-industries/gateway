# Security Best Practices Review - Pending Findings

Date: 2026-04-30

## Executive Summary

This trimmed report only tracks vulnerabilities that still need a fix. Dependency advisories, Docker file command injection, rate-limit client IP trust, request body limits, and notification webhook SSRF policy have been fixed in the current code and are intentionally omitted.

One high-impact finding remains pending:

- The production Gateway container still runs as root while mounting the host Docker socket.

## Pending Findings

### SEC-004: Production Gateway container runs as root while mounting the host Docker socket

Severity: High

Status: Pending

Location:

- `Dockerfile:36` to `Dockerfile:73`
- `docker-compose.yml:67` to `docker-compose.yml:68`

Evidence:

The production stage in the root `Dockerfile` does not switch to a non-root user before `CMD`, while Compose mounts:

```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

Impact:

Any backend remote code execution, dependency compromise, or template/parser escape inside the app container can become host-level Docker control through the Docker socket. Running as root increases the impact of filesystem and process-level escapes inside the container.

Recommended fix:

- Add a non-root runtime user to the root `Dockerfile`, matching the safer pattern in `packages/backend/Dockerfile`.
- Avoid mounting the host Docker socket into the main app container. Use a narrow socket proxy, a dedicated self-update sidecar with minimal endpoints, or require external orchestration for updates.
- If the socket must remain mounted, document it as a privileged deployment mode and make it explicit/opt-in.
