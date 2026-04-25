import { Box, FolderPlus, HardDrive, Layers, ListTodo, Network, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageTransition } from "@/components/common/PageTransition";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import { isNodeIncompatible } from "@/types";
import { DockerContainers } from "./DockerContainers";
import { DockerImages } from "./DockerImages";
import { DockerNetworks } from "./DockerNetworks";
import { DockerTasks } from "./DockerTasks";
import { DockerVolumes } from "./DockerVolumes";

const TABS = [
  { value: "containers", label: "Containers", icon: Box, scope: "docker:containers:list" },
  { value: "images", label: "Images", icon: Layers, scope: "docker:images:list" },
  { value: "volumes", label: "Volumes", icon: HardDrive, scope: "docker:volumes:list" },
  { value: "networks", label: "Networks", icon: Network, scope: "docker:networks:list" },
  { value: "tasks", label: "Tasks", icon: ListTodo, scope: "docker:tasks" },
] as const;

export function Docker() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { hasScope, hasScopedAccess } = useAuthStore();
  const selectedNodeId = useDockerStore((s) => s.selectedNodeId);
  const dockerNodes = useDockerStore((s) => s.dockerNodes);
  const setSelectedNode = useDockerStore((s) => s.setSelectedNode);
  const setDockerNodes = useDockerStore((s) => s.setDockerNodes);
  const fetchContainers = useDockerStore((s) => s.fetchContainers);
  const fetchImages = useDockerStore((s) => s.fetchImages);
  const fetchVolumes = useDockerStore((s) => s.fetchVolumes);
  const fetchNetworks = useDockerStore((s) => s.fetchNetworks);
  const loading = useDockerStore((s) => s.loading);

  const deployContainerRef = useRef<(() => void) | null>(null);
  const createFolderRef = useRef<(() => void) | null>(null);
  const pullImageRef = useRef<(() => void) | null>(null);
  const createVolumeRef = useRef<(() => void) | null>(null);
  const createNetworkRef = useRef<(() => void) | null>(null);

  const visibleTabs = TABS.filter((t) => hasScopedAccess(t.scope));
  const activeTab =
    tabParam && visibleTabs.some((t) => t.value === tabParam)
      ? tabParam
      : visibleTabs[0]?.value || "containers";
  const usesFillLayout = activeTab === "tasks";
  const activeTabLoading =
    activeTab === "containers"
      ? loading.containers
      : activeTab === "images"
        ? loading.images
        : activeTab === "volumes"
          ? loading.volumes
          : activeTab === "networks"
            ? loading.networks
            : activeTab === "tasks"
              ? loading.tasks
              : false;

  useEffect(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  // Fetch docker nodes on mount, store in zustand for multi-node fetching
  useEffect(() => {
    api
      .listNodes({ type: "docker", limit: 100 })
      .then((r) => {
        setDockerNodes(
          r.data.filter((n) => n.status === "online" && n.isConnected && !isNodeIncompatible(n))
        );
      })
      .catch(() => toast.error("Failed to load Docker nodes"));
  }, [setDockerNodes]);

  useEffect(() => {
    if (!selectedNodeId && dockerNodes.length === 0) return;
    const refreshActiveTab = () => {
      switch (activeTab) {
        case "containers":
          void fetchContainers();
          break;
        case "images":
          void fetchImages();
          break;
        case "volumes":
          void fetchVolumes();
          break;
        case "networks":
          void fetchNetworks();
          break;
      }
    };
    refreshActiveTab();
    const interval = setInterval(refreshActiveTab, 30_000);
    return () => clearInterval(interval);
  }, [
    activeTab,
    dockerNodes.length,
    selectedNodeId,
    fetchContainers,
    fetchImages,
    fetchVolumes,
    fetchNetworks,
  ]);

  const handleTabChange = (value: string) => {
    navigate(`/docker/${value}`, { replace: true });
  };

  const handleRefresh = async () => {
    switch (activeTab) {
      case "containers":
        return fetchContainers();
      case "images":
        return fetchImages();
      case "volumes":
        return fetchVolumes();
      case "networks":
        return fetchNetworks();
    }
  };

  const renderActions = () => {
    switch (activeTab) {
      case "containers":
        return (
          <>
            {hasScopedAccess("docker:containers:edit") && (
              <Button variant="outline" onClick={() => createFolderRef.current?.()}>
                <FolderPlus className="h-4 w-4 mr-1" />
                New Folder
              </Button>
            )}
            {hasScope("docker:containers:create") && (
              <Button onClick={() => deployContainerRef.current?.()}>
                <Plus className="h-4 w-4 mr-1" />
                Deploy
              </Button>
            )}
          </>
        );
      case "images":
        return hasScope("docker:images:pull") ? (
          <Button onClick={() => pullImageRef.current?.()}>
            <Plus className="h-4 w-4 mr-1" />
            Pull Image
          </Button>
        ) : null;
      case "volumes":
        return hasScope("docker:volumes:create") ? (
          <Button onClick={() => createVolumeRef.current?.()}>
            <Plus className="h-4 w-4 mr-1" />
            Create Volume
          </Button>
        ) : null;
      case "networks":
        return hasScope("docker:networks:create") ? (
          <Button onClick={() => createNetworkRef.current?.()}>
            <Plus className="h-4 w-4 mr-1" />
            Create Network
          </Button>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <PageTransition>
      <div
        className={
          usesFillLayout
            ? "h-full overflow-hidden flex flex-col p-6 gap-4"
            : activeTab === "containers"
              ? "h-full overflow-y-auto px-6 pt-6 pb-3 space-y-4"
              : "h-full overflow-y-auto p-6 space-y-4"
        }
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div>
            <h1 className="text-2xl font-bold">Docker</h1>
            <p className="text-sm text-muted-foreground">
              Manage containers, images, volumes, and networks
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton onClick={handleRefresh} disabled={activeTabLoading} />
            {renderActions()}
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className={`flex flex-col ${usesFillLayout ? "flex-1 min-h-0" : ""}`}
        >
          <TabsList className="shrink-0">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="containers">
            <DockerContainers
              embedded
              onDeployRef={(fn) => {
                deployContainerRef.current = fn;
              }}
              onCreateFolderRef={(fn) => {
                createFolderRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="images">
            <DockerImages
              embedded
              onPullRef={(fn) => {
                pullImageRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="volumes">
            <DockerVolumes
              embedded
              onCreateRef={(fn) => {
                createVolumeRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="networks">
            <DockerNetworks
              embedded
              onCreateRef={(fn) => {
                createNetworkRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="tasks" className="flex flex-col flex-1 min-h-0">
            <DockerTasks embedded />
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}
