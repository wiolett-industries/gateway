import { FlaskConical, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

interface NodeConfigTabProps {
  nodeId: string;
  nodeStatus: string;
}

export function NodeConfigTab({ nodeId, nodeStatus }: NodeConfigTabProps) {
  const { hasScope } = useAuthStore();
  const canManage = hasScope("proxy:manage");

  const [configContent, setConfigContent] = useState("");
  const [originalConfig, setOriginalConfig] = useState("");
  const [loading, setLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (nodeStatus !== "online") return;
    const load = async () => {
      setLoading(true);
      try {
        const content = await api.getNodeNginxConfig(nodeId);
        setConfigContent(content);
        setOriginalConfig(content);
      } catch {
        toast.error("Failed to load nginx config");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [nodeId, nodeStatus]);

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const result = await api.testNodeNginxConfig(nodeId);
      if (result.valid) {
        toast.success("Configuration test passed");
      } else {
        toast.error(result.error || "Configuration test failed");
      }
    } catch {
      toast.error("Failed to test config");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await api.updateNodeNginxConfig(nodeId, configContent);
      if (result.valid) {
        toast.success("Config saved and nginx reloaded");
        setOriginalConfig(configContent);
      } else {
        toast.error(result.error || "Config test failed, changes rolled back");
      }
    } catch {
      toast.error("Failed to save config");
    } finally {
      setIsSaving(false);
    }
  };

  if (nodeStatus !== "online") {
    return (
      <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card mt-4">
        <p className="text-muted-foreground">Node is offline — configuration unavailable</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const hasChanges = configContent !== originalConfig;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className="flex-1 min-h-0 flex flex-col">
        <CodeEditor
          value={configContent}
          onChange={canManage ? setConfigContent : () => {}}
          readOnly={!canManage}
        />
      </div>

      <div className="flex items-center justify-end gap-2 mt-3">
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            Read-only — proxy:manage permission required to edit
          </p>
        )}
        <Button variant="outline" size="sm" onClick={handleTest} disabled={isTesting}>
          <FlaskConical className="h-4 w-4" />
          {isTesting ? "Testing..." : "Test"}
        </Button>
        {canManage && (
          <Button size="sm" onClick={handleSave} disabled={isSaving || !hasChanges}>
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save & Reload"}
          </Button>
        )}
      </div>
    </div>
  );
}
