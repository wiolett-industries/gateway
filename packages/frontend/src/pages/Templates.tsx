import { FileText, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { CertificateType, KeyAlgorithm, Template } from "@/types";

export function Templates() {
  const { hasRole } = useAuthStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [certType, setCertType] = useState<CertificateType>("tls-server");
  const [keyAlgorithm, setKeyAlgorithm] = useState<KeyAlgorithm>("ecdsa-p256");
  const [validityDays, setValidityDays] = useState(365);
  const [isSaving, setIsSaving] = useState(false);

  const loadTemplates = async () => {
    try {
      const data = await api.listTemplates();
      setTemplates(data || []);
    } catch (err) {
      toast.error("Failed to load templates");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setCertType("tls-server");
    setKeyAlgorithm("ecdsa-p256");
    setValidityDays(365);
    setDialogOpen(true);
  };

  const openEdit = (template: Template) => {
    setEditing(template);
    setName(template.name);
    setDescription(template.description || "");
    setCertType(template.certType);
    setKeyAlgorithm(template.keyAlgorithm);
    setValidityDays(template.validityDays);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    setIsSaving(true);
    try {
      if (editing) {
        await api.updateTemplate(editing.id, {
          name,
          description,
          certType,
          keyAlgorithm,
          validityDays,
        });
        toast.success("Template updated");
      } else {
        await api.createTemplate({
          name,
          description,
          certType,
          keyAlgorithm,
          validityDays,
          keyUsage: [],
          extKeyUsage: [],
          requireSans: true,
          sanTypes: ["dns", "ip"],
        });
        toast.success("Template created");
      }
      setDialogOpen(false);
      loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (template: Template) => {
    const ok = await confirm({ title: "Delete Template", description: `Are you sure you want to delete "${template.name}"? This action cannot be undone.`, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api.deleteTemplate(template.id);
      toast.success("Template deleted");
      loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete template");
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-sm text-muted-foreground">Certificate issuance templates</p>
        </div>
        {hasRole("admin", "operator") && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create Template
          </Button>
        )}
      </div>

      {/* Template grid */}
      {templates.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <div key={template.id} className="border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">{template.name}</h3>
                </div>
                {hasRole("admin", "operator") && !template.isBuiltin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(template)}>
                        <Pencil className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDelete(template)} className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {template.description || "No description"}
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-xs capitalize">{template.certType}</Badge>
                <Badge variant="secondary" className="text-xs">{template.keyAlgorithm}</Badge>
                <Badge variant="secondary" className="text-xs">{template.validityDays}d</Badge>
                {template.isBuiltin && (
                  <Badge className="text-xs">Built-in</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <p className="text-muted-foreground">No templates yet</p>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "Create Template"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update template settings" : "Create a new certificate issuance template"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Web Server TLS" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Template description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Certificate Type</label>
                <Select value={certType} onValueChange={(v) => setCertType(v as CertificateType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls-server">TLS Server</SelectItem>
                    <SelectItem value="tls-client">TLS Client</SelectItem>
                    <SelectItem value="code-signing">Code Signing</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Validity (days)</label>
                <NumericInput value={validityDays} onChange={(v) => setValidityDays(v)} min={1} max={3650} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Key Algorithm</label>
              <Select value={keyAlgorithm} onValueChange={(v) => setKeyAlgorithm(v as KeyAlgorithm)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rsa-2048">RSA-2048</SelectItem>
                  <SelectItem value="rsa-4096">RSA-4096</SelectItem>
                  <SelectItem value="ecdsa-p256">ECDSA-P256</SelectItem>
                  <SelectItem value="ecdsa-p384">ECDSA-P384</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving || validityDays < 1 || validityDays > 3650}>
              {isSaving ? "Saving..." : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </PageTransition>
  );
}
