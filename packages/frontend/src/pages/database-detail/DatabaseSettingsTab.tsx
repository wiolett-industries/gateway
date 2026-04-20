import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { api } from "@/services/api";
import type { DatabaseConnection } from "@/types";
import {
  buildDatabasePayload,
  DatabaseConnectionForm,
  draftFromConnection,
  type DatabaseConnectionDraft,
} from "./DatabaseConnectionForm";

export function DatabaseSettingsTab({
  database,
  onSaved,
}: {
  database: DatabaseConnection;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DatabaseConnectionDraft>(draftFromConnection(database));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(draftFromConnection(database));
  }, [database]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateDatabase(database.id, buildDatabasePayload(draft));
      toast.success("Database settings updated");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update database");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <DatabaseConnectionForm draft={draft} onChange={setDraft} disableType mode="metadata" />
      <DialogFooter>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </div>
  );
}
