import { Copy, FileCode, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { NginxTemplate } from "@/types";

export function NginxTemplates({
  embedded,
  onCreateRef,
}: {
  embedded?: boolean;
  onCreateRef?: (fn: () => void) => void;
}) {
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const cachedTemplates = api.getCached<NginxTemplate[]>("nginx-templates:list");
  const [templates, setTemplates] = useState<NginxTemplate[]>(cachedTemplates ?? []);
  const [isLoading, setIsLoading] = useState(!cachedTemplates);

  const load = useCallback(async () => {
    try {
      const data = await api.listNginxTemplates();
      setTemplates(data || []);
    } catch {
      toast.error("Failed to load templates");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtime("nginx.template.changed", () => {
    load();
  });

  // Expose create action to parent
  const createRefSet = useRef(false);
  if (onCreateRef && !createRefSet.current) {
    onCreateRef(() => navigate("/nginx-templates/new"));
    createRefSet.current = true;
  }

  const handleClone = async (id: string) => {
    try {
      const clone = await api.cloneNginxTemplate(id);
      toast.success("Template cloned");
      navigate(`/nginx-templates/${clone.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clone");
    }
  };

  const handleDelete = async (t: NginxTemplate) => {
    const ok = await confirm({
      title: "Delete Template",
      description: `Delete "${t.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteNginxTemplate(t.id);
      toast.success("Template deleted");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const content = (
    <>
      <div className={embedded ? "space-y-4" : "h-full overflow-y-auto p-6 space-y-4"}>
        {!embedded && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold">Config Templates</h1>
              <p className="text-sm text-muted-foreground">
                Nginx server block templates for proxy hosts
              </p>
            </div>
            {hasScope("proxy:edit") && (
              <Button onClick={() => navigate("/nginx-templates/new")}>
                <Plus className="h-4 w-4" />
                Create Template
              </Button>
            )}
          </div>
        )}

        {templates.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => {
              const canEditTemplate = hasScope("proxy:edit") && !t.isBuiltin;
              const canCloneTemplate = hasScope("proxy:edit");
              const canDeleteTemplate = hasScope("proxy:delete") && !t.isBuiltin;
              const hasActions = canEditTemplate || canCloneTemplate || canDeleteTemplate;

              return (
                <div key={t.id} className="border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex items-center gap-2 ${
                        canEditTemplate ? "cursor-pointer hover:opacity-80" : ""
                      }`}
                      onClick={
                        canEditTemplate ? () => navigate(`/nginx-templates/${t.id}`) : undefined
                      }
                    >
                      <FileCode className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-semibold text-sm">{t.name}</h3>
                    </div>
                    {hasActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEditTemplate && (
                            <DropdownMenuItem onClick={() => navigate(`/nginx-templates/${t.id}`)}>
                              <Pencil className="h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          {canCloneTemplate && (
                            <DropdownMenuItem onClick={() => handleClone(t.id)}>
                              <Copy className="h-4 w-4" />
                              Clone
                            </DropdownMenuItem>
                          )}
                          {canDeleteTemplate && (
                            <>
                              {(canEditTemplate || canCloneTemplate) && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                onClick={() => handleDelete(t)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {t.description || "No description"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-xs uppercase">
                      {t.type}
                    </Badge>
                    {t.isBuiltin && <Badge className="text-xs">Built-in</Badge>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            message="No config templates."
            actionLabel={hasScope("proxy:edit") ? "Create one" : undefined}
            actionHref={hasScope("proxy:edit") ? "/nginx-templates/new" : undefined}
          />
        )}
      </div>
    </>
  );

  if (embedded) return content;
  return <PageTransition>{content}</PageTransition>;
}
