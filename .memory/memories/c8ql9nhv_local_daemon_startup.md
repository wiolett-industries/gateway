---
{
  "id": "c8ql9nhv",
  "file_name": "c8ql9nhv_local_daemon_startup",
  "tags": [
    "daemons",
    "dev-env",
    "docker",
    "local-setup"
  ],
  "layer": "deep",
  "ref": null,
  "created_at": 1776736379470,
  "updated_at": 1776736379470
}
---
In the gateway repo's local environment, standalone containers named daemon-nginx and daemon-docker were created from ubuntu:24.04 with Cmd ["sleep","infinity"], so they do not auto-start their daemon processes. daemon-nginx has nginx-daemon installed and valid config at /etc/nginx-daemon/config.yaml; starting `nginx-daemon run` inside the container successfully connected it to the gateway. daemon-docker is privileged and includes both dockerd and docker-daemon; it requires starting Docker-in-Docker first (`dockerd` on /var/run/docker.sock), then `docker-daemon run`, after which it connects successfully to the gateway.
