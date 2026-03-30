import { useEffect, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { api } from "@/services/api";

interface AIToolAccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabledTools: string[];
  onSave: (disabledTools: string[]) => void;
}

export function AIToolAccessModal({
  open,
  onOpenChange,
  disabledTools: initialDisabled,
  onSave,
}: AIToolAccessModalProps) {
  const [tools, setTools] = useState<
    Record<
      string,
      Array<{ name: string; description: string; destructive: boolean; requiredRole: string }>
    >
  >({});
  const [disabledTools, setDisabledTools] = useState<string[]>(initialDisabled);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setDisabledTools(initialDisabled);
      api
        .getAITools()
        .then(setTools)
        .catch(() => toast.error("Failed to load tools"));
    }
  }, [open, initialDisabled]);

  const toggleTool = (toolName: string) => {
    setDisabledTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    );
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      onSave(disabledTools);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const categories = Object.keys(tools);
  const totalTools = Object.values(tools).flat().length;
  const enabledCount = totalTools - disabledTools.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>AI Tool Access</DialogTitle>
          <DialogDescription>Control which tools the AI assistant can use</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="border border-border max-h-96 overflow-y-auto">
            {categories.map((category, ci) => (
              <div key={category}>
                {ci > 0 && <Separator />}
                <div className="px-3 py-1.5 bg-muted/50">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {category}
                  </p>
                </div>
                {tools[category].map((tool) => {
                  const isEnabled = !disabledTools.includes(tool.name);
                  return (
                    <label
                      key={tool.name}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => toggleTool(tool.name)}
                        className="form-checkbox"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          {tool.description}
                          {tool.destructive && (
                            <span className="ml-1 text-[10px] text-yellow-600 dark:text-yellow-400">
                              (requires approval)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {tool.name}
                          <span className="ml-2 text-muted-foreground/60">
                            min: {tool.requiredRole}
                          </span>
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {enabledCount} of {totalTools} tool{totalTools !== 1 ? "s" : ""} enabled
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
