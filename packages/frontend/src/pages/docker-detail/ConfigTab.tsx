import { Check, ClipboardCopy } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import type { InspectData } from "./helpers";

export function ConfigTab({ data }: { data: InspectData }) {
  const jsonText = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText).then(
      () => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1000);
      },
      () => toast.error("Failed to copy")
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="overflow-hidden flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border border-border border-b-0 bg-card">
          <div>
            <h3 className="text-sm font-semibold">Container Inspect</h3>
            <p className="text-xs text-muted-foreground">Full container configuration (read-only)</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy} title="Copy JSON">
            <Check className={`h-3.5 w-3.5 absolute transition-all duration-200 ${copied ? "scale-100 opacity-100" : "scale-0 opacity-0"}`} />
            <ClipboardCopy className={`h-3.5 w-3.5 transition-all duration-200 ${copied ? "scale-0 opacity-0" : "scale-100 opacity-100"}`} />
          </Button>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0 flex flex-col">
          <CodeEditor
            value={jsonText}
            onChange={() => {}}
            readOnly
            language="json"
          />
        </div>
      </div>
    </div>
  );
}
