import { Copy, FileCode, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
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
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { NginxTemplate } from "@/types";

export function NginxTemplates() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const [templates, setTemplates] = useState<NginxTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    try {
      const data = await api.listNginxTemplates();
      setTemplates(data || []);
    } catch {
      toast.error("Failed to load templates");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Config Templates</h1>
          <p className="text-sm text-muted-foreground">Nginx server block templates for proxy hosts</p>
        </div>
        {hasRole("admin", "operator") && (
          <Button onClick={() => navigate("/nginx-templates/new")}>
            <Plus className="h-4 w-4" />
            Create Template
          </Button>
        )}
      </div>

      {templates.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div
                  className="flex items-center gap-2 cursor-pointer hover:opacity-80"
                  onClick={() => !t.isBuiltin && navigate(`/nginx-templates/${t.id}`)}
                >
                  <FileCode className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">{t.name}</h3>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!t.isBuiltin && (
                      <DropdownMenuItem onClick={() => navigate(`/nginx-templates/${t.id}`)}>
                        <Pencil className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {hasRole("admin", "operator") && (
                      <DropdownMenuItem onClick={() => handleClone(t.id)}>
                        <Copy className="h-4 w-4" />
                        Clone
                      </DropdownMenuItem>
                    )}
                    {!t.isBuiltin && hasRole("admin") && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDelete(t)} className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {t.description || "No description"}
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-xs uppercase">{t.type}</Badge>
                {t.isBuiltin && <Badge className="text-xs">Built-in</Badge>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <p className="text-muted-foreground">No config templates yet</p>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
