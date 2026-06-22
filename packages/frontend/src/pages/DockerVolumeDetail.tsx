import { ArrowLeft, Download, EllipsisVertical, Save, Settings, Trash2, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { PanelShell } from "@/components/common/PanelShell";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { SimpleTable, type SimpleTableColumn } from "@/components/common/SimpleTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtime } from "@/hooks/use-realtime";
import { useStableNavigate } from "@/hooks/use-stable-navigate";
import { useUrlTab } from "@/hooks/use-url-tab";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { DockerVolume } from "@/types";
import { FilesTab } from "./docker-detail/FilesTab";
import { LabelsSection } from "./docker-detail/LabelsSection";

type LabelEntry = { key: string; value: string };
type VolumeUsageContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  canOpen: boolean;
};

function labelsToEntries(labels: Record<string, string> | undefined): LabelEntry[] {
  return Object.entries(labels ?? {}).map(([key, value]) => ({ key, value }));
}

function labelsToRecord(labels: LabelEntry[]): Record<string, string> {
  return labels.reduce<Record<string, string>>((acc, label) => {
    const key = label.key.trim();
    if (key) acc[key] = label.value;
    return acc;
  }, {});
}

function labelsSignature(labels: LabelEntry[]) {
  return JSON.stringify(
    Object.entries(labelsToRecord(labels)).sort(([a], [b]) => a.localeCompare(b))
  );
}

export function DockerVolumeDetail() {
  const { nodeId, volumeName } = useParams<{
    nodeId: string;
    volumeName: string;
    tab?: string;
  }>();
  const navigate = useStableNavigate();
  const { hasScope } = useAuthStore();
  const decodedVolumeName = volumeName ?? "";
  const encodedVolumeName = encodeURIComponent(decodedVolumeName);
  const [activeTab, setActiveTab] = useUrlTab(
    ["files", "settings"],
    "files",
    (tab) => `/docker/volumes/${nodeId}/${encodedVolumeName}/${tab}`
  );
  const [volume, setVolume] = useState<DockerVolume | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [labelsSaving, setLabelsSaving] = useState(false);
  const [labels, setLabels] = useState<LabelEntry[]>([]);
  const [savedLabels, setSavedLabels] = useState<LabelEntry[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [usageContainers, setUsageContainers] = useState<VolumeUsageContainer[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const canCreateVolume =
    hasScope("docker:volumes:create") || !!(nodeId && hasScope(`docker:volumes:create:${nodeId}`));
  const canDeleteVolume =
    hasScope("docker:volumes:delete") || !!(nodeId && hasScope(`docker:volumes:delete:${nodeId}`));
  const canRenameVolume = canCreateVolume && canDeleteVolume;
  const usedBy = useMemo<string[]>(() => {
    const raw = volume?.usedBy ?? (volume as any)?.UsedBy;
    return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === "string") : [];
  }, [volume]);
  const isUsed = usedBy.length > 0 || (volume?.usedByCount ?? 0) > 0;
  const labelsChanged = labelsSignature(labels) !== labelsSignature(savedLabels);
  const usageColumns = useMemo<SimpleTableColumn<VolumeUsageContainer>[]>(
    () => [
      {
        id: "container",
        header: "Container",
        render: (container) => <span className="font-mono">{container.name}</span>,
      },
      {
        id: "image",
        header: "Image",
        cellClassName: "font-mono text-muted-foreground",
        render: (container) => container.image || "-",
      },
      {
        id: "state",
        header: "State",
        align: "right",
        render: (container) =>
          container.state ? (
            <Badge variant={container.state === "running" ? "success" : "secondary"}>
              {container.state}
            </Badge>
          ) : (
            "-"
          ),
      },
    ],
    []
  );

  const fetchVolume = useCallback(
    async (silent = false) => {
      if (!nodeId || !decodedVolumeName) return;
      if (!silent) setIsLoading(true);
      try {
        let data = await api.inspectDockerVolume(nodeId, decodedVolumeName);
        if (!Array.isArray(data.usedBy) && data.usedByCount == null) {
          const volumes = await api.listDockerVolumes(nodeId, { search: decodedVolumeName });
          const listItem = volumes.find((item) => item.name === decodedVolumeName);
          if (listItem) {
            data = {
              ...data,
              usedBy: listItem.usedBy,
              usedByCount: listItem.usedByCount,
              usedByTruncated: listItem.usedByTruncated,
            };
          }
        }
        setVolume(data);
        const nextLabels = labelsToEntries(data.labels);
        setLabels(nextLabels);
        setSavedLabels(nextLabels);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load volume");
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [decodedVolumeName, nodeId]
  );

  useEffect(() => {
    void fetchVolume();
  }, [fetchVolume]);

  useEffect(() => {
    if (!nodeId || usedBy.length === 0) {
      setUsageContainers([]);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    api
      .listDockerContainers(nodeId)
      .then((containers) => {
        if (cancelled) return;
        const matched = (containers ?? [])
          .filter((container: any) => usedBy.includes((container.name ?? "").replace(/^\//, "")))
          .map((container: any) => ({
            id: container.id ?? "",
            name: (container.name ?? "").replace(/^\//, ""),
            image: container.image ?? "",
            state: container.state ?? "",
            canOpen: true,
          }));
        setUsageContainers(
          matched.length > 0
            ? matched
            : usedBy.map((name) => ({
                id: name,
                name,
                image: "",
                state: "",
                canOpen: false,
              }))
        );
      })
      .catch(() => {
        if (!cancelled) {
          setUsageContainers(
            usedBy.map((name) => ({ id: name, name, image: "", state: "", canOpen: false }))
          );
        }
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, usedBy]);

  useRealtime("docker.volume.changed", (payload) => {
    const event = payload as { nodeId?: string; name?: string };
    if (event.nodeId && event.nodeId !== nodeId) return;
    if (event.name && event.name !== decodedVolumeName) return;
    void fetchVolume(true);
  });

  const fetchDirectory = useCallback(
    (path: string) => {
      if (!nodeId || !decodedVolumeName) return Promise.resolve([]);
      return api.listVolumeDir(nodeId, decodedVolumeName, path);
    },
    [decodedVolumeName, nodeId]
  );

  const handleExport = useCallback(async () => {
    if (!nodeId || !decodedVolumeName) return;
    setExporting(true);
    try {
      const blob = await api.exportDockerVolume(nodeId, decodedVolumeName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${decodedVolumeName}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Volume export started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export volume");
    } finally {
      setExporting(false);
    }
  }, [decodedVolumeName, nodeId]);

  const openRename = useCallback(() => {
    setRenameValue(decodedVolumeName);
    setRenameOpen(true);
  }, [decodedVolumeName]);

  const handleRename = useCallback(async () => {
    if (!nodeId || !decodedVolumeName || !renameValue.trim()) return;
    const nextName = renameValue.trim();
    if (nextName === decodedVolumeName) {
      setRenameOpen(false);
      return;
    }
    setActionLoading(true);
    try {
      await api.renameVolume(nodeId, decodedVolumeName, nextName);
      toast.success("Volume renamed");
      setRenameOpen(false);
      navigate(`/docker/volumes/${nodeId}/${encodeURIComponent(nextName)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename volume");
    } finally {
      setActionLoading(false);
    }
  }, [decodedVolumeName, navigate, nodeId, renameValue]);

  const handleRemove = useCallback(async () => {
    if (!nodeId || !decodedVolumeName) return;
    const ok = await confirm({
      title: "Remove Volume",
      description: `Remove volume "${decodedVolumeName}"? Any data stored in this volume will be permanently lost.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setActionLoading(true);
    try {
      await api.removeVolume(nodeId, decodedVolumeName);
      toast.success("Volume removed");
      navigate("/docker/volumes");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove volume");
    } finally {
      setActionLoading(false);
    }
  }, [decodedVolumeName, navigate, nodeId]);

  const handleSaveLabels = useCallback(async () => {
    if (!nodeId || !decodedVolumeName || !labelsChanged || isUsed) return;
    setLabelsSaving(true);
    try {
      await api.updateVolumeLabels(nodeId, decodedVolumeName, labelsToRecord(labels));
      toast.success("Volume labels saved");
      const nextLabels = labelsToEntries(
        (await api.inspectDockerVolume(nodeId, decodedVolumeName)).labels
      );
      setLabels(nextLabels);
      setSavedLabels(nextLabels);
      void fetchVolume(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save labels");
    } finally {
      setLabelsSaving(false);
    }
  }, [decodedVolumeName, fetchVolume, isUsed, labels, labelsChanged, nodeId]);

  const headerActions = [
    ...(canRenameVolume
      ? [
          {
            label: "Rename",
            icon: <Type className="h-4 w-4" />,
            onClick: openRename,
            disabled: actionLoading || isUsed,
          },
        ]
      : []),
    ...(canDeleteVolume
      ? [
          {
            label: "Remove",
            icon: <Trash2 className="h-4 w-4" />,
            onClick: handleRemove,
            disabled: actionLoading || isUsed,
            destructive: true,
            separatorBefore: true,
          },
        ]
      : []),
  ];

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <Button variant="ghost" size="icon" onClick={() => navigate("/docker/volumes")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold truncate">{decodedVolumeName}</h1>
                  {volume?.driver && <Badge variant="secondary">{volume.driver}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {volume?.mountpoint ?? (isLoading ? "Loading volume..." : "Docker volume")}
                </p>
              </div>
            </div>
            <ResponsiveHeaderActions actions={headerActions}>
              {canRenameVolume && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={openRename}
                  disabled={actionLoading || isUsed}
                >
                  <Type className="h-3.5 w-3.5" />
                  Rename
                </Button>
              )}
              {canDeleteVolume && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" disabled={actionLoading}>
                      <EllipsisVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleRemove}
                      disabled={isUsed}
                      className="text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </ResponsiveHeaderActions>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col min-h-0">
            <TabsList className="shrink-0">
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="settings">
                <Settings className="h-3.5 w-3.5 mr-1" />
                Settings
              </TabsTrigger>
            </TabsList>
            <TabsContent value="files" className="pb-0">
              <FilesTab nodeId={nodeId!} canBrowse fetchDirectory={fetchDirectory} />
            </TabsContent>
            <TabsContent value="settings" className="pb-0">
              <div className="space-y-6">
                <PanelShell
                  title="Usage"
                  description="Containers currently attached to this volume."
                >
                  <SimpleTable
                    columns={usageColumns}
                    rows={usageContainers}
                    getRowKey={(container) => container.id}
                    loading={usageLoading}
                    emptyMessage="No containers"
                    isRowClickable={(container) => container.canOpen}
                    onRowClick={(container) => {
                      navigate(`/docker/containers/${nodeId}/${container.id}`);
                    }}
                  />
                </PanelShell>

                <LabelsSection
                  canEdit={canRenameVolume && !isUsed}
                  labels={labels}
                  setLabels={setLabels}
                  labelsChanged={labelsChanged}
                  inputCell="h-9 rounded-none border-0 bg-transparent px-3 focus-visible:ring-0 focus-visible:ring-offset-0"
                  description={
                    isUsed
                      ? "Stop and detach containers using this volume before editing labels."
                      : "Saved by recreating the unused volume with the same contents."
                  }
                  action={
                    canRenameVolume ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleSaveLabels}
                        disabled={!labelsChanged || labelsSaving || isUsed}
                        aria-label="Save labels"
                        title="Save labels"
                      >
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                    ) : null
                  }
                />

                <PanelShell
                  title="Export"
                  description="Download a tar.gz archive with the current volume contents."
                  headerBorder={false}
                  actions={
                    <Button size="sm" onClick={handleExport} disabled={exporting}>
                      <Download className="h-3.5 w-3.5" />
                      {exporting ? "Exporting..." : "Export"}
                    </Button>
                  }
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Volume</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            disabled={actionLoading}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="New volume name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={actionLoading || !renameValue.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
