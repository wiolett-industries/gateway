import { Download, FileJson, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageTransition } from "@/components/common/PageTransition";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import type { DockerTemplate, Node } from "@/types";
import { isNodeIncompatible } from "@/types";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

export function DockerTemplatesPage({
  embedded,
  onCreateRef,
}: {
  embedded?: boolean;
  onCreateRef?: (fn: () => void) => void;
} = {}) {
  const { hasScope } = useAuthStore();
  const { templates, fetchTemplates } = useDockerStore();

  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const openCreate = useCallback(() => {
    setEditingId(null);
    setFormName("");
    setFormDescription("");
    setFormConfig("{}");
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    onCreateRef?.(openCreate);
  }, [onCreateRef, openCreate]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formConfig, setFormConfig] = useState("{}");
  const [saving, setSaving] = useState(false);

  // Deploy dialog
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployTemplateId, setDeployTemplateId] = useState<string | null>(null);
  const [deployNodeId, setDeployNodeId] = useState("");
  const [deployOverrides, setDeployOverrides] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [dockerNodes, setDockerNodes] = useState<Node[]>([]);

  const loadTemplatesPageData = useCallback(async () => {
    await fetchTemplates().finally(() => setIsLoading(false));
    api
      .listNodes({ type: "docker", limit: 100 })
      .then((r) =>
        setDockerNodes(r.data.filter((n) => n.status === "online" && !isNodeIncompatible(n)))
      )
      .catch(() => {});
  }, [fetchTemplates]);

  useEffect(() => {
    void loadTemplatesPageData();
  }, [loadTemplatesPageData]);

  useRealtime("docker.template.changed", () => {
    fetchTemplates();
  });

  const filteredTemplates = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)
    );
  }, [templates, search]);

  const openEdit = useCallback((t: DockerTemplate) => {
    setEditingId(t.id);
    setFormName(t.name);
    setFormDescription(t.description ?? "");
    setFormConfig(JSON.stringify(t.config, null, 2));
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingId(null);
  }, []);

  const handleSave = async () => {
    if (!formName.trim()) return;
    let config: object;
    try {
      config = JSON.parse(formConfig);
    } catch {
      toast.error("Invalid JSON configuration");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateDockerTemplate(editingId, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          config,
        });
        toast.success("Template updated");
      } else {
        await api.createDockerTemplate({
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          config,
        });
        toast.success("Template created");
      }
      closeDialog();
      fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(
    async (t: DockerTemplate) => {
      const ok = await confirm({
        title: "Delete Template",
        description: `Delete template "${t.name}"? This cannot be undone.`,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      try {
        await api.deleteDockerTemplate(t.id);
        toast.success("Template deleted");
        fetchTemplates();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete template");
      }
    },
    [fetchTemplates]
  );

  const openDeploy = useCallback(
    (t: DockerTemplate) => {
      setDeployTemplateId(t.id);
      setDeployNodeId(dockerNodes.length > 0 ? dockerNodes[0].id : "");
      setDeployOverrides("");
      setDeployOpen(true);
    },
    [dockerNodes]
  );

  const handleDeploy = async () => {
    if (!deployTemplateId || !deployNodeId) return;
    let overrides: object | undefined;
    if (deployOverrides.trim()) {
      try {
        overrides = JSON.parse(deployOverrides);
      } catch {
        toast.error("Invalid JSON overrides");
        return;
      }
    }
    setDeploying(true);
    try {
      await api.deployTemplate(deployTemplateId, {
        nodeId: deployNodeId,
        overrides,
      });
      toast.success("Template deployed");
      setDeployOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deploy template");
    } finally {
      setDeploying(false);
    }
  };

  const handleExport = useCallback((t: DockerTemplate) => {
    const json = JSON.stringify(
      { name: t.name, description: t.description, config: t.config },
      null,
      2
    );
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!data.name || !data.config) {
          toast.error("Invalid template file: missing name or config");
          return;
        }
        await api.createDockerTemplate({
          name: data.name,
          description: data.description,
          config: data.config,
        });
        toast.success(`Template "${data.name}" imported`);
        fetchTemplates();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to import template");
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const extractImage = useCallback((config: Record<string, unknown>): string => {
    if (typeof config.image === "string") return config.image;
    if (typeof config.Image === "string") return config.Image;
    return "-";
  }, []);

  const templateColumns: DataTableColumn<DockerTemplate>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        render: (t) => (
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
              <FileJson className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{t.name}</p>
              {t.description && (
                <p className="text-xs text-muted-foreground truncate">{t.description}</p>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "image",
        header: "Image",
        render: (t) => (
          <span className="text-xs font-mono text-muted-foreground truncate">
            {extractImage(t.config)}
          </span>
        ),
      },
      {
        key: "created",
        header: "Created",
        align: "right" as const,
        render: (t) => (
          <span className="text-sm text-muted-foreground">{formatDate(t.createdAt)}</span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        align: "right" as const,
        render: (t) => (
          <div
            className="flex items-center gap-0.5 justify-end"
            onClick={(e) => e.stopPropagation()}
          >
            {hasScope("docker:templates:create") && dockerNodes.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openDeploy(t)}
                title="Deploy"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            {hasScope("docker:templates:create") && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openEdit(t)}
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handleExport(t)}
              title="Export JSON"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            {hasScope("docker:templates:delete") && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleDelete(t)}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [hasScope, dockerNodes.length, openDeploy, openEdit, handleExport, handleDelete, extractImage]
  );
  const canDeployTemplate = hasScope("docker:templates:create") && dockerNodes.length > 0;
  const canEditTemplate = hasScope("docker:templates:create");
  const canDeleteTemplate = hasScope("docker:templates:delete");
  const hasTemplateActions = canDeployTemplate || canEditTemplate || canDeleteTemplate;
  const visibleTemplateColumns = templateColumns.filter(
    (column) => column.key !== "actions" || hasTemplateActions
  );

  const content = (
    <>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Docker Templates</h1>
              <Badge variant="secondary">{templates.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Create and manage reusable container deployment templates
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            {hasScope("docker:templates:create") && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" />
                Create Template
              </Button>
            )}
          </div>
        </div>
      )}

      <SearchFilterBar
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={() => {}}
        placeholder="Search templates..."
        hasActiveFilters={search !== ""}
        onReset={() => setSearch("")}
      />

      {filteredTemplates.length > 0 ? (
        <DataTable
          columns={visibleTemplateColumns}
          data={filteredTemplates}
          keyFn={(t) => t.id}
          emptyMessage="No templates found."
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          Loading templates...
        </div>
      ) : (
        <EmptyState
          message="No templates created yet."
          hasActiveFilters={search !== ""}
          onReset={() => setSearch("")}
          actionLabel={hasScope("docker:templates:create") ? "Create a template" : undefined}
          onAction={hasScope("docker:templates:create") ? openCreate : undefined}
        />
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "Create Template"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the template configuration."
                : "Create a reusable container deployment template."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My Template"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                className="mt-1"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="A brief description"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Configuration (JSON)</label>
              <textarea
                className="mt-1 w-full border border-border bg-muted p-3 font-mono text-xs min-h-[200px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                value={formConfig}
                onChange={(e) => setFormConfig(e.target.value)}
                placeholder='{"image": "nginx:latest", "ports": [{"hostPort": 80, "containerPort": 80}]}'
              />
              <p className="text-xs text-muted-foreground mt-1">
                Accepts ContainerCreateConfig format: image, name, ports, env, volumes, etc.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deploy Dialog */}
      <Dialog open={deployOpen} onOpenChange={() => setDeployOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deploy Template</DialogTitle>
            <DialogDescription>Deploy this template to a Docker node.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Target Node <span className="text-destructive">*</span>
              </label>
              <Select value={deployNodeId} onValueChange={setDeployNodeId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a node" />
                </SelectTrigger>
                <SelectContent>
                  {dockerNodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            n.status === "online" ? "bg-emerald-500" : "bg-muted-foreground/40"
                          }`}
                        />
                        {n.displayName || n.hostname}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">
                Overrides (JSON){" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                className="mt-1 w-full border border-border bg-muted p-3 font-mono text-xs min-h-[100px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                value={deployOverrides}
                onChange={(e) => setDeployOverrides(e.target.value)}
                placeholder='{"name": "custom-name"}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeployOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeploy} disabled={deploying || !deployNodeId}>
              {deploying ? "Deploying..." : "Deploy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return <div className="flex flex-col flex-1 min-h-0 space-y-4">{content}</div>;

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">{content}</div>
    </PageTransition>
  );
}
