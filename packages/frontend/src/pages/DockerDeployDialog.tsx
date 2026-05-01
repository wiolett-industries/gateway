import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { ContainerCreateConfig, DockerRegistry, Node } from "@/types";
import { isNodeIncompatible } from "@/types";

const tabContentTransition = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const };
const EMPTY_DOCKER_NODES: Node[] = [];

interface DockerDeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected node ID (e.g. from the current node filter) */
  nodeId?: string;
  /** Extra list of docker nodes to show in the node selector */
  dockerNodes?: Node[];
  /** Called after a successful deploy; receives the new container ID if available */
  onDeployed?: (containerId?: string) => void;
}

export function DockerDeployDialog({
  open,
  onOpenChange,
  nodeId,
  dockerNodes = EMPTY_DOCKER_NODES,
  onDeployed,
}: DockerDeployDialogProps) {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();

  const [deployNodeId, setDeployNodeId] = useState<string>("");
  const [deployImage, setDeployImage] = useState("");
  const [deployRegistryId, setDeployRegistryId] = useState("");
  const [registries, setRegistries] = useState<DockerRegistry[]>([]);
  const [deployLocalImages, setDeployLocalImages] = useState<string[]>([]);
  const [deployPullableImages, setDeployPullableImages] = useState<string[]>([]);
  const [deployName, setDeployName] = useState("");
  const [deployRestart, setDeployRestart] = useState("no");
  const [deploying, setDeploying] = useState(false);
  const [deployMode, setDeployMode] = useState<"container" | "deployment">("container");
  const [routeHostPort, setRouteHostPort] = useState("8080");
  const [routeContainerPort, setRouteContainerPort] = useState("80");
  const [healthPath, setHealthPath] = useState("/");
  const [drainSeconds, setDrainSeconds] = useState("30");
  const allNodes = useMemo(() => {
    const storeNodes = useDockerStore.getState().dockerNodes;
    return storeNodes.length > 0 ? storeNodes : dockerNodes;
  }, [dockerNodes]);
  const availableNodes = useMemo(() => allNodes.filter((n) => !isNodeIncompatible(n)), [allNodes]);
  const availableRegistries = useMemo(
    () =>
      registries.filter(
        (registry) => registry.scope === "global" || registry.nodeId === deployNodeId
      ),
    [deployNodeId, registries]
  );

  // Reset form state when dialog opens
  useEffect(() => {
    if (open) {
      const initialNode = nodeId ? allNodes.find((n) => n.id === nodeId) : null;
      setDeployNodeId(initialNode?.serviceCreationLocked ? "" : nodeId || "");
      setDeployImage("");
      setDeployRegistryId("");
      setDeployName("");
      setDeployRestart("no");
      setDeployMode("container");
      setRouteHostPort("8080");
      setRouteContainerPort("80");
      setHealthPath("/");
      setDrainSeconds("30");
    }
  }, [allNodes, open, nodeId]);

  useEffect(() => {
    if (!open || !hasScope("docker:registries:view")) {
      setRegistries([]);
      return;
    }
    api
      .listDockerRegistries()
      .then(setRegistries)
      .catch(() => setRegistries([]));
  }, [hasScope, open]);

  useEffect(() => {
    if (!open || !deployNodeId) return;
    const selectedNode = allNodes.find((n) => n.id === deployNodeId);
    if (selectedNode?.serviceCreationLocked) setDeployNodeId("");
  }, [allNodes, deployNodeId, open]);

  // Fetch local images + pullable images from other nodes when deploy node changes
  useEffect(() => {
    if (!deployNodeId) {
      setDeployLocalImages([]);
      setDeployPullableImages([]);
      return;
    }

    const extractTags = (data: unknown): string[] => {
      const tags: string[] = [];
      for (const img of Array.isArray(data) ? data : []) {
        for (const t of (img as any).repoTags ?? (img as any).RepoTags ?? []) {
          if (t && t !== "<none>:<none>") tags.push(t);
        }
      }
      return tags;
    };

    // Fetch local images
    api
      .listDockerImages(deployNodeId)
      .then((data) => setDeployLocalImages(extractTags(data).sort()))
      .catch(() => setDeployLocalImages([]));

    // Fetch images from other nodes (pullable) — only if user can pull
    if (!hasScope("docker:images:pull")) {
      setDeployPullableImages([]);
      return;
    }
    const otherNodes = useDockerStore.getState().dockerNodes.filter((n) => n.id !== deployNodeId);
    if (otherNodes.length > 0) {
      Promise.all(
        otherNodes.map((n) =>
          api
            .listDockerImages(n.id)
            .then(extractTags)
            .catch(() => [] as string[])
        )
      ).then((results) => {
        const localSet = new Set<string>();
        api
          .listDockerImages(deployNodeId)
          .then((d) => {
            for (const t of extractTags(d)) localSet.add(t);
            const pullable = new Set<string>();
            for (const tags of results) {
              for (const t of tags) {
                if (!localSet.has(t)) pullable.add(t);
              }
            }
            setDeployPullableImages(Array.from(pullable).sort());
          })
          .catch(() => {});
      });
    } else {
      setDeployPullableImages([]);
    }
  }, [deployNodeId, hasScope]);

  const closeDeploy = () => {
    onOpenChange(false);
    setDeployImage("");
    setDeployName("");
    setDeployRestart("no");
    setDeployMode("container");
  };

  const handleDeploy = async () => {
    if (!deployNodeId || !deployImage.trim()) return;
    if (allNodes.find((n) => n.id === deployNodeId)?.serviceCreationLocked) {
      toast.error("Node is locked for new service creation");
      return;
    }
    if (deployMode === "deployment" && !deployName.trim()) return;
    setDeploying(true);
    try {
      let imageRef = deployImage.trim();
      // Auto-pull if image not available locally
      const isLocal = deployLocalImages.includes(imageRef);
      if (!isLocal) {
        toast.info(`Pulling "${imageRef}"...`);
        const pullResult = await api.pullImageSync(
          deployNodeId,
          imageRef,
          deployRegistryId || undefined
        );
        imageRef = pullResult.imageRef;
      }
      if (deployMode === "deployment") {
        const deployment = await api.createDockerDeployment(deployNodeId, {
          name: deployName.trim(),
          image: imageRef,
          registryId: deployRegistryId || undefined,
          restartPolicy: deployRestart === "no" ? "unless-stopped" : deployRestart,
          routes: [
            {
              hostPort: Number(routeHostPort),
              containerPort: Number(routeContainerPort),
              isPrimary: true,
            },
          ],
          health: {
            path: healthPath || "/",
            statusMin: 200,
            statusMax: 399,
            timeoutSeconds: 5,
            intervalSeconds: 5,
            successThreshold: 2,
            startupGraceSeconds: 5,
            deployTimeoutSeconds: 300,
          },
          drainSeconds: Number(drainSeconds) || 0,
        });
        toast.success("Deployment created");
        closeDeploy();
        onDeployed?.(deployment.id);
        navigate(`/docker/deployments/${deployNodeId}/${deployment.id}`);
      } else {
        const config: ContainerCreateConfig = {
          image: imageRef,
          registryId: deployRegistryId || undefined,
          restartPolicy: deployRestart,
        };
        if (deployName.trim()) config.name = deployName.trim();
        const result = await api.createContainer(deployNodeId, config);
        toast.success("Container deployed");
        closeDeploy();
        const newId = (result as any)?.id ?? (result as any)?.Id;
        onDeployed?.(newId);
        if (newId) navigate(`/docker/containers/${deployNodeId}/${newId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deploy");
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={closeDeploy}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy</DialogTitle>
          <DialogDescription>Create a container or a blue/green deployment.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs
            value={deployMode}
            onValueChange={(value) => setDeployMode(value as "container" | "deployment")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="container">Container</TabsTrigger>
              <TabsTrigger value="deployment">Blue/green</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Node */}
          <div>
            <label className="text-sm font-medium">
              Node <span className="text-destructive">*</span>
            </label>
            <Select
              value={deployNodeId}
              onValueChange={(v) => {
                setDeployNodeId(v);
                setDeployImage("");
                setDeployRegistryId("");
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a node" />
              </SelectTrigger>
              <SelectContent>
                {availableNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id} disabled={n.serviceCreationLocked}>
                    {n.displayName || n.hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Registry */}
          <div>
            <label className="text-sm font-medium">Registry</label>
            <Select
              value={deployRegistryId || "__default__"}
              onValueChange={(v) => setDeployRegistryId(v === "__default__" ? "" : v)}
              disabled={!deployNodeId}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={!deployNodeId ? "Select a node first" : "Docker Hub"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Docker Hub</SelectItem>
                {availableRegistries.map((registry) => (
                  <SelectItem key={registry.id} value={registry.id}>
                    {registry.name} ({registry.url})
                    {registry.scope === "node" ? " · this node" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Image */}
          <div>
            <label className="text-sm font-medium">
              Image <span className="text-destructive">*</span>
            </label>
            <Select value={deployImage} onValueChange={setDeployImage} disabled={!deployNodeId}>
              <SelectTrigger className="mt-1">
                <SelectValue
                  placeholder={!deployNodeId ? "Select a node first" : "Select an image"}
                />
              </SelectTrigger>
              <SelectContent>
                {deployLocalImages.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>On this node</SelectLabel>
                    {deployLocalImages.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {deployPullableImages.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Available to pull</SelectLabel>
                    {deployPullableImages.map((tag) => (
                      <SelectItem key={`pull:${tag}`} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {deployLocalImages.length === 0 && deployPullableImages.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    No images available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <Input
              className="mt-2"
              value={deployImage}
              onChange={(e) => setDeployImage(e.target.value)}
              disabled={!deployNodeId}
              placeholder={!deployNodeId ? "Select a node first" : "Type any image reference"}
            />
            {deployImage && !deployLocalImages.includes(deployImage) && deployNodeId && (
              <p className="text-xs text-muted-foreground mt-1">
                Will be pulled to this node on deploy
              </p>
            )}
          </div>

          {/* Container name */}
          <div>
            <label className="text-sm font-medium">
              {deployMode === "deployment" ? "Deployment Name" : "Container Name"}{" "}
              {deployMode === "container" && (
                <span className="text-muted-foreground font-normal">(optional)</span>
              )}
            </label>
            <Input
              className="mt-1"
              value={deployName}
              onChange={(e) => setDeployName(e.target.value)}
              placeholder={deployMode === "deployment" ? "my-app" : "my-container"}
            />
          </div>

          <AnimatePresence initial={false}>
            {deployMode === "deployment" && (
              <motion.div
                key="blue-green-fields"
                className="overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={tabContentTransition}
              >
                <motion.div
                  className="space-y-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={tabContentTransition}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium">Host Port</label>
                      <Input
                        className="mt-1"
                        inputMode="numeric"
                        value={routeHostPort}
                        onChange={(e) => setRouteHostPort(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Container Port</label>
                      <Input
                        className="mt-1"
                        inputMode="numeric"
                        value={routeContainerPort}
                        onChange={(e) => setRouteContainerPort(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium">Health Path</label>
                      <Input
                        className="mt-1"
                        value={healthPath}
                        onChange={(e) => setHealthPath(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Drain Seconds</label>
                      <Input
                        className="mt-1"
                        inputMode="numeric"
                        value={drainSeconds}
                        onChange={(e) => setDrainSeconds(e.target.value)}
                      />
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Restart policy */}
          <div>
            <label className="text-sm font-medium">Restart Policy</label>
            <Select value={deployRestart} onValueChange={setDeployRestart}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="unless-stopped">Unless Stopped</SelectItem>
                <SelectItem value="on-failure">On Failure</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeDeploy}>
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={
              deploying ||
              !deployImage.trim() ||
              !deployNodeId ||
              (deployMode === "deployment" &&
                (!deployName.trim() || !Number(routeHostPort) || !Number(routeContainerPort)))
            }
          >
            {deploying ? "Deploying..." : "Deploy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
