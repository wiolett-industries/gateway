import { Box, HardDrive, Layers, ListTodo, Network, Plus } from "lucide-react";
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
  const { hasScope } = useAuthStore();
  const setDockerNodes = useDockerStore((s) => s.setDockerNodes);
  const fetchContainers = useDockerStore((s) => s.fetchContainers);
  const fetchImages = useDockerStore((s) => s.fetchImages);
  const fetchVolumes = useDockerStore((s) => s.fetchVolumes);
  const fetchNetworks = useDockerStore((s) => s.fetchNetworks);
  const isLoading = useDockerStore((s) => s.isLoading);

  const deployContainerRef = useRef<(() => void) | null>(null);
  const pullImageRef = useRef<(() => void) | null>(null);
  const createVolumeRef = useRef<(() => void) | null>(null);
  const createNetworkRef = useRef<(() => void) | null>(null);

  const visibleTabs = TABS.filter((t) => hasScope(t.scope));
  const activeTab =
    tabParam && visibleTabs.some((t) => t.value === tabParam)
      ? tabParam
      : visibleTabs[0]?.value || "containers";

  // Fetch docker nodes on mount, store in zustand for multi-node fetching
  useEffect(() => {
    api
      .listNodes({ type: "docker", limit: 100 })
      .then((r) => {
        setDockerNodes(r.data);
        if (r.data.length > 0) {
          const store = useDockerStore.getState();
          store.fetchContainers();
          store.fetchImages();
          store.fetchVolumes();
          store.fetchNetworks();
        }
      })
      .catch(() => toast.error("Failed to load Docker nodes"));
  }, []);

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
        return hasScope("docker:containers:create") ? (
          <Button onClick={() => deployContainerRef.current?.()}>
            <Plus className="h-4 w-4 mr-1" />
            Deploy
          </Button>
        ) : null;
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
      <div className="h-full flex flex-col p-6 gap-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div>
            <h1 className="text-2xl font-bold">Docker</h1>
            <p className="text-sm text-muted-foreground">
              Manage containers, images, volumes, and networks
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshButton onClick={handleRefresh} disabled={isLoading} />
            {renderActions()}
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="containers" className="flex flex-col flex-1 min-h-0">
            <DockerContainers
              embedded
              onDeployRef={(fn) => {
                deployContainerRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="images" className="flex flex-col flex-1 min-h-0">
            <DockerImages
              embedded
              onPullRef={(fn) => {
                pullImageRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="volumes" className="flex flex-col flex-1 min-h-0">
            <DockerVolumes
              embedded
              onCreateRef={(fn) => {
                createVolumeRef.current = fn;
              }}
            />
          </TabsContent>
          <TabsContent value="networks" className="flex flex-col flex-1 min-h-0">
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
