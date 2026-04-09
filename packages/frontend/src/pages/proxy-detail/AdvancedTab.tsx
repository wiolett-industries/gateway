import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";

export interface AdvancedTabProps {
  advancedConfig: string;
  setAdvancedConfig: (v: string) => void;
  editorErrorLines: number[];
  setEditorErrorLines: (v: number[]) => void;
  onValidate: () => Promise<boolean>;
  onSaveAdvanced: () => void;
  isSavingAdvanced: boolean;
  canManage: boolean;
}

export function AdvancedTab({
  advancedConfig,
  setAdvancedConfig,
  editorErrorLines,
  setEditorErrorLines,
  onValidate,
  onSaveAdvanced,
  isSavingAdvanced,
  canManage,
}: AdvancedTabProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <CodeEditor
        value={advancedConfig}
        onChange={(val) => {
          setAdvancedConfig(val);
          setEditorErrorLines([]);
        }}
        errorLines={editorErrorLines}
      />
      {canManage && (
        <div className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onValidate}>
            Validate
          </Button>
          <Button size="sm" onClick={onSaveAdvanced} disabled={isSavingAdvanced}>
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
