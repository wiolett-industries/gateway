import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";
import { dockerContainerRoute } from "@/lib/resource-routes";
import { usePinnedContainersStore } from "@/stores/pinned-containers";
import { useResolvedPageContext } from "@/stores/resolved-page-context";

interface UseContainerDetailRealtimeParams {
  nodeId?: string;
  nodeSlug: string;
  containerId?: string;
  routeContainerName: string;
  activeTab: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  fetchContainer: (noCache?: boolean) => Promise<void>;
  clearMutationTransition: () => void;
  onContainerIdChange: (containerId: string) => void;
  pageContextToken?: number | null;
}

export function useContainerDetailRealtime({
  nodeId,
  nodeSlug,
  containerId,
  routeContainerName,
  activeTab,
  navigate,
  fetchContainer,
  clearMutationTransition,
  onContainerIdChange,
  pageContextToken,
}: UseContainerDetailRealtimeParams) {
  useRealtime("node.slug.changed", (payload) => {
    const event = payload as { id?: string; oldSlug?: string; slug?: string };
    if (event.id !== nodeId || event.oldSlug !== nodeSlug || !event.slug) return;
    navigate(dockerContainerRoute(event.slug, routeContainerName, activeTab), { replace: true });
  });

  useRealtime("docker.container.changed", (payload) => {
    const ev = payload as {
      nodeId?: string;
      name?: string;
      id?: string;
      oldId?: string;
      oldName?: string;
      action?: string;
      transition?: string | null;
    };
    if (!ev || ev.nodeId !== nodeId) return;

    if (
      ev.action === "renamed" &&
      ev.id === containerId &&
      ev.oldName === routeContainerName &&
      ev.name &&
      ev.name !== routeContainerName
    ) {
      navigate(dockerContainerRoute(nodeSlug, ev.name, activeTab), { replace: true });
      return;
    }

    if (
      ev.action === "recreated" &&
      ev.oldId &&
      ev.oldId === containerId &&
      ev.name === routeContainerName &&
      ev.id &&
      ev.id !== containerId
    ) {
      clearMutationTransition();
      try {
        usePinnedContainersStore.getState().migrateId(ev.oldId, ev.id);
      } catch {
        /* ignore */
      }
      onContainerIdChange(ev.id);
      if (pageContextToken != null && nodeId) {
        useResolvedPageContext.getState().resolve(pageContextToken, {
          resourceType: "docker-container",
          resourceId: ev.id,
          nodeId,
          label: routeContainerName,
        });
      }
      return;
    }

    const matchesCurrentContainer =
      ev.id === containerId && (!ev.name || ev.name === routeContainerName);
    const matchesIdlessTransitionClear =
      ev.action === "transitioning" && !ev.id && ev.name === routeContainerName;
    if (!matchesCurrentContainer && !matchesIdlessTransitionClear) return;

    if (ev.action === "removed") {
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
