import { useEffect, useState } from "react";
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
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import { isNodeIncompatible } from "@/types";
import type { ContainerCreateConfig, Node } from "@/types";

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
  dockerNodes = [],
  onDeployed,
}: DockerDeployDialogProps) {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();

  const [deployNodeId, setDeployNodeId] = useState<string>("");
  const [deployImage, setDeployImage] = useState("");
  const [deployLocalImages, setDeployLocalImages] = useState<string[]>([]);
  const [deployPullableImages, setDeployPullableImages] = useState<string[]>([]);
  const [deployName, setDeployName] = useState("");
  const [deployRestart, setDeployRestart] = useState("no");
  const [deploying, setDeploying] = useState(false);

  // Reset form state when dialog opens
  useEffect(() => {
    if (open) {
      setDeployNodeId(nodeId || "");
      setDeployImage("");
      setDeployName("");
      setDeployRestart("no");
    }
  }, [open, nodeId]);

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
  }, [deployNodeId]);

  const closeDeploy = () => {
    onOpenChange(false);
    setDeployImage("");
    setDeployName("");
    setDeployRestart("no");
  };

  const handleDeploy = async () => {
    if (!deployNodeId || !deployImage.trim()) return;
    setDeploying(true);
    try {
      // Auto-pull if image not available locally
      const isLocal = deployLocalImages.includes(deployImage.trim());
      if (!isLocal) {
        toast.info(`Pulling "${deployImage.trim()}"...`);
        await api.pullImage(deployNodeId, deployImage.trim());
      }
      const config: ContainerCreateConfig = {
        image: deployImage.trim(),
        restartPolicy: deployRestart,
      };
      if (deployName.trim()) config.name = deployName.trim();
      const result = await api.createContainer(deployNodeId, config);
      toast.success("Container deployed");
      closeDeploy();
      const newId = (result as any)?.id ?? (result as any)?.Id;
      onDeployed?.(newId);
      if (newId) navigate(`/docker/containers/${deployNodeId}/${newId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deploy container");
    } finally {
      setDeploying(false);
    }
  };

  // Resolve available nodes: prefer store nodes, fall back to prop; filter incompatible
  const allNodes =
    useDockerStore.getState().dockerNodes.length > 0
      ? useDockerStore.getState().dockerNodes
      : dockerNodes;
  const availableNodes = allNodes.filter((n) => !isNodeIncompatible(n));

  return (
    <Dialog open={open} onOpenChange={closeDeploy}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy Container</DialogTitle>
          <DialogDescription>Create and start a new container.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a node" />
              </SelectTrigger>
              <SelectContent>
                {availableNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.displayName || n.hostname}
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
            {deployImage && !deployLocalImages.includes(deployImage) && deployNodeId && (
              <p className="text-xs text-muted-foreground mt-1">
                Will be pulled to this node on deploy
              </p>
            )}
          </div>

          {/* Container name */}
          <div>
            <label className="text-sm font-medium">
              Container Name <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              className="mt-1"
              value={deployName}
              onChange={(e) => setDeployName(e.target.value)}
              placeholder="my-container"
            />
          </div>

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
            disabled={deploying || !deployImage.trim() || !deployNodeId}
          >
            {deploying ? "Deploying..." : "Deploy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
