import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LoggingEnvironment } from "@/types";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function LoggingEnvironmentDialog({
  open,
  environment,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  environment?: LoggingEnvironment | null;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Partial<LoggingEnvironment>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(environment?.name ?? "");
    setSlug(environment?.slug ?? "");
    setDescription(environment?.description ?? "");
  }, [environment, open]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        slug: slug || slugify(name),
        description: description || null,
        schemaMode: environment?.schemaMode ?? "loose",
        retentionDays: environment?.retentionDays ?? 30,
        fieldSchema: environment?.fieldSchema ?? [],
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{environment ? "Edit Environment" : "Create Environment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Name</span>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!environment) setSlug(slugify(event.target.value));
              }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Slug</span>
            <Input value={slug} onChange={(event) => setSlug(slugify(event.target.value))} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Description</span>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || !slug.trim() || saving} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
