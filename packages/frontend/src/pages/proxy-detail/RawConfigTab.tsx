import { RefreshCw, Save } from "lucide-react";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { cn } from "@/lib/utils";

export interface RawConfigTabProps {
  isRawMode: boolean;
  rawConfig: string;
  setRawConfig: (v: string) => void;
  renderedConfig: string;
  isLoadingRaw: boolean;
  isSavingRaw: boolean;
  editorErrorLines: number[];
  setEditorErrorLines: (v: number[]) => void;
  onValidate: () => Promise<boolean>;
  onSaveRaw: () => void;
  onRefreshRendered: () => void;
  canManage: boolean;
}

export function RawConfigTab({
  isRawMode,
  rawConfig,
  setRawConfig,
  renderedConfig,
  isLoadingRaw,
  isSavingRaw,
  editorErrorLines,
  setEditorErrorLines,
  onValidate,
  onSaveRaw,
  onRefreshRendered,
  canManage,
}: RawConfigTabProps) {
  if (isRawMode) {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative">
        <CodeEditor
          value={rawConfig}
          minHeight="0px"
          onChange={(val) => {
            setRawConfig(val);
            setEditorErrorLines([]);
          }}
          errorLines={editorErrorLines}
        />
        {canManage && (
          <div className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onValidate}>
              Validate
            </Button>
            <Button size="sm" onClick={onSaveRaw} disabled={isSavingRaw}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isLoadingRaw) {
    return <LoadingSpinner className="py-8" />;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <CodeEditor value={renderedConfig} onChange={() => {}} readOnly minHeight="0px" />
      <Button
        variant="outline"
        size="sm"
        className="absolute right-2.5 bottom-2.5 z-10"
        onClick={onRefreshRendered}
        disabled={isLoadingRaw}
      >
        <RefreshCw className={cn("h-4 w-4", isLoadingRaw && "animate-spin")} />
        Refresh
      </Button>
    </div>
  );
}
