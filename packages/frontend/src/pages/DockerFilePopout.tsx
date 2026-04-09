import { Check, ClipboardCopy, Download, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/services/api";

export function DockerFilePopout() {
  const { nodeId, containerId } = useParams<{ nodeId: string; containerId: string }>();
  const [searchParams] = useSearchParams();
  const filePath = searchParams.get("path") || "/";
  const isWritable = searchParams.get("writable") === "1";

  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const didFetch = useRef(false);

  const hasChanges = content !== null && content !== savedContent;

  useEffect(() => {
    const fileName = filePath.split("/").pop() || filePath;
    document.title = `${fileName} — ${containerId?.slice(0, 12)}`;
  }, [filePath, containerId]);

  useEffect(() => {
    if (!nodeId || !containerId || didFetch.current) return;
    didFetch.current = true;

    setIsLoading(true);
    api
      .readContainerFile(nodeId, containerId, filePath)
      .then((data) => {
        let text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        try {
          // Daemon uses URL-safe base64 — convert to standard before decoding
          const std = text.replace(/-/g, "+").replace(/_/g, "/");
          text = decodeURIComponent(escape(atob(std)));
        } catch {
          /* not base64 */
        }
        setContent(text);
        setSavedContent(text);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to read file");
      })
      .finally(() => setIsLoading(false));
  }, [nodeId, containerId, filePath]);

  const fileName = filePath.split("/").pop() || "file";

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1000);
      },
      () => toast.error("Failed to copy")
    );
  };

  const handleDownload = () => {
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = useCallback(async () => {
    if (!nodeId || !containerId || content === null) return;
    setIsSaving(true);
    try {
      const encoded = btoa(content);
      await api.writeContainerFile(nodeId, containerId, filePath, encoded);
      setSavedContent(content);
      toast.success("File saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setIsSaving(false);
    }
  }, [nodeId, containerId, filePath, content]);

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-card">
        <div>
          <h3 className="text-sm font-semibold">{fileName}</h3>
          <p className="text-xs text-muted-foreground font-mono">{filePath}</p>
        </div>
        {content !== null && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopy}
              title="Copy"
            >
              <Check
                className={`h-3.5 w-3.5 absolute transition-all duration-200 ${copied ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
              />
              <ClipboardCopy
                className={`h-3.5 w-3.5 transition-all duration-200 ${copied ? "scale-0 opacity-0" : "scale-100 opacity-100"}`}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleDownload}
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            {isWritable && (
              <Button size="sm" onClick={handleSave} disabled={isSaving || !hasChanges}>
                <Save className="h-3.5 w-3.5" />
                Save
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Reading file...
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-destructive text-sm">
          {error}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <CodeEditor
            value={content ?? ""}
            onChange={isWritable ? setContent : () => {}}
            readOnly={!isWritable}
          />
        </div>
      )}
      <Toaster position="bottom-right" />
    </div>
  );
}
