import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";
import { usePinnedContainersStore } from "@/stores/pinned-containers";

interface UseContainerDetailRealtimeParams {
  nodeId?: string;
  containerId?: string;
  containerName: string;
  activeTab: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  fetchContainer: (noCache?: boolean) => Promise<void>;
  clearMutationTransition: () => void;
}

export function useContainerDetailRealtime({
  nodeId,
  containerId,
  containerName,
  activeTab,
  navigate,
  fetchContainer,
  clearMutationTransition,
}: UseContainerDetailRealtimeParams) {
  useRealtime("docker.container.changed", (payload) => {
    const ev = payload as {
      nodeId?: string;
      name?: string;
      id?: string;
      oldId?: string;
      action?: string;
      transition?: string | null;
    };
    if (!ev || ev.nodeId !== nodeId) return;
    const matchesName = containerName && ev.name === containerName;
    const matchesId = ev.id === containerId || ev.oldId === containerId;
    if (!matchesName && !matchesId) return;

    if (ev.action === "recreated" && ev.id && ev.oldId && ev.id !== containerId) {
      clearMutationTransition();
      try {
        usePinnedContainersStore.getState().migrateId(ev.oldId, ev.id);
      } catch {
        /* ignore */
      }
      navigate(`/docker/containers/${nodeId}/${ev.id}/${activeTab}`, { replace: true });
      return;
    }
    if (ev.action === "removed" && (ev.id === containerId || ev.name === containerName)) {
      clearMutationTransition();
      toast.info("Container was removed");
      navigate("/docker");
      return;
    }
    if (ev.action === "transitioning" && !ev.transition) {
      clearMutationTransition();
    }
    void fetchContainer(true);
  });
}
