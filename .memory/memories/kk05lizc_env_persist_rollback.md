---
{
  "id": "kk05lizc",
  "file_name": "kk05lizc_env_persist_rollback",
  "tags": [
    "backend",
    "daemon",
    "database",
    "docker",
    "env",
    "recreate",
    "rollback"
  ],
  "layer": "deep",
  "ref": null,
  "created_at": 1776689846569,
  "updated_at": 1776689846569
}
---
Docker container environment variables are now persisted in the backend database in a docker_env_vars table, separate from docker_secrets but using the same CryptoService envelope encryption pattern. DockerManagementService reads DB-backed env vars first, seeds existing runtime env into DB on first read, persists env updates after the daemon accepts the update request, and merges stored env + secrets into recreate/update flows. The docker daemon recreate path in packages/daemons/docker/internal/docker/client.go now accepts env/removeEnv on recreate and attempts rollback by recreating the original container snapshot if the replacement container fails to create or start after the old container was removed.
