import { FileText, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { CertificateType, KeyAlgorithm, SignatureAlgorithm, Template } from "@/types";

export function Templates() {
  const { hasRole } = useAuthStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CertificateType>("server");
  const [keyAlgorithm, setKeyAlgorithm] = useState<KeyAlgorithm>("EC-P256");
  const [signatureAlgorithm, setSignatureAlgorithm] = useState<SignatureAlgorithm>("ECDSAWithSHA256");
  const [validityDays, setValidityDays] = useState(365);
  const [isSaving, setIsSaving] = useState(false);

  const loadTemplates = async () => {
    try {
      const { data } = await api.listTemplates();
      setTemplates(data);
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
    setType("server");
    setKeyAlgorithm("EC-P256");
    setSignatureAlgorithm("ECDSAWithSHA256");
    setValidityDays(365);
    setDialogOpen(true);
  };

  const openEdit = (template: Template) => {
    setEditing(template);
    setName(template.name);
    setDescription(template.description);
    setType(template.type);
    setKeyAlgorithm(template.keyAlgorithm);
    setSignatureAlgorithm(template.signatureAlgorithm);
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
          type,
          keyAlgorithm,
          signatureAlgorithm,
          validityDays,
        });
        toast.success("Template updated");
      } else {
        await api.createTemplate({
          name,
          description,
          type,
          keyAlgorithm,
          signatureAlgorithm,
          validityDays,
          keyUsage: [],
          extendedKeyUsage: [],
          subjectConstraints: { requireCommonName: true },
          sanConstraints: { allowDNS: true, allowIP: true, allowEmail: false },
          isDefault: false,
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
    if (!confirm(`Delete template "${template.name}"?`)) return;
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
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
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
                {hasRole("admin", "operator") && (
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
                <Badge variant="secondary" className="text-xs capitalize">{template.type}</Badge>
                <Badge variant="secondary" className="text-xs">{template.keyAlgorithm}</Badge>
                <Badge variant="secondary" className="text-xs">{template.validityDays}d</Badge>
                {template.isDefault && (
                  <Badge className="text-xs">Default</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <FileText className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No templates yet</p>
          {hasRole("admin", "operator") && (
            <Button variant="outline" size="sm" onClick={openCreate}>
              Create your first template
            </Button>
          )}
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
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as CertificateType)}
                  className="flex h-9 w-full border border-input bg-transparent px-3 text-sm"
                >
                  <option value="server">Server</option>
                  <option value="client">Client</option>
                  <option value="codesign">Code Signing</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Validity (days)</label>
                <Input
                  type="number"
                  value={validityDays}
                  onChange={(e) => setValidityDays(parseInt(e.target.value) || 365)}
                  min={1}
                  max={3650}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Key Algorithm</label>
                <select
                  value={keyAlgorithm}
                  onChange={(e) => setKeyAlgorithm(e.target.value as KeyAlgorithm)}
                  className="flex h-9 w-full border border-input bg-transparent px-3 text-sm"
                >
                  <option value="RSA-2048">RSA-2048</option>
                  <option value="RSA-4096">RSA-4096</option>
                  <option value="EC-P256">EC-P256</option>
                  <option value="EC-P384">EC-P384</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Signature Algorithm</label>
                <select
                  value={signatureAlgorithm}
                  onChange={(e) => setSignatureAlgorithm(e.target.value as SignatureAlgorithm)}
                  className="flex h-9 w-full border border-input bg-transparent px-3 text-sm"
                >
                  <option value="SHA256WithRSA">SHA256WithRSA</option>
                  <option value="SHA384WithRSA">SHA384WithRSA</option>
                  <option value="SHA512WithRSA">SHA512WithRSA</option>
                  <option value="ECDSAWithSHA256">ECDSAWithSHA256</option>
                  <option value="ECDSAWithSHA384">ECDSAWithSHA384</option>
                </select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
