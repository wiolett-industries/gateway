import type { DockerContainer } from "@/types";

export function matchesDockerContainerStatus(
  container: Pick<DockerContainer, "availability" | "state" | "_transition">,
  status: string
) {
  if (status === "all") return true;
  if (status === "unavailable") return container.availability === "unavailable";
  if (container.availability === "unavailable") return false;

  const effectiveState = container._transition ?? container.state;
  return status === "running" ? effectiveState === "running" : effectiveState !== "running";
}
