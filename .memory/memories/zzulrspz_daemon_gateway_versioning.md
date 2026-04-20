---
{
  "id": "zzulrspz",
  "file_name": "zzulrspz_daemon_gateway_versioning",
  "tags": [
    "compatibility",
    "daemon",
    "gateway",
    "updates",
    "versioning"
  ],
  "layer": "deep",
  "ref": null,
  "created_at": 1776726813806,
  "updated_at": 1776726813806
}
---
Gateway marks a daemon as incompatible during gRPC registration by comparing the running gateway APP_VERSION with msg.register.daemonVersion using isMinorCompatible(). Compatibility requires the same major.minor; patch differences are allowed. If either version is 'dev' or unparsable, it is treated as compatible. The GitLab release feed in DaemonUpdateService is only used to compute updateAvailable/latestVersion and does not control incompatibility.
