import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LabelsSectionProps {
  canEdit: boolean;
  labels: Array<{ key: string; value: string }>;
  setLabels: React.Dispatch<React.SetStateAction<Array<{ key: string; value: string }>>>;
  labelsChanged: boolean;
  inputCell: string;
}

export function LabelsSection({
  canEdit,
  labels,
  setLabels,
  labelsChanged,
  inputCell,
}: LabelsSectionProps) {
  const addLabel = () => setLabels((l) => [...l, { key: "", value: "" }]);
  const removeLabel = (i: number) => setLabels((l) => l.filter((_, idx) => idx !== i));
  const updateLabel = (i: number, field: "key" | "value", val: string) =>
    setLabels((l) => l.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry)));

  return (
    <div
      className="border bg-card overflow-hidden"
      style={labelsChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Labels</h3>
          <p className="text-xs text-muted-foreground">Requires container recreation</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={addLabel}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>
      {labels.length > 0 ? (
        <>
          <div className="grid grid-cols-[1fr_1fr] border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="px-3 py-2">Key</div>
            <div className="px-3 py-2 border-l border-border">Value</div>
          </div>
          <div className="-mb-px">
            {labels.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr] border-b border-border last:border-b-0"
              >
                <Input
                  className={inputCell}
                  value={l.key}
                  onChange={(e) => updateLabel(i, "key", e.target.value)}
                  placeholder="com.example.key"
                  disabled={!canEdit}
                />
                <div className="flex items-center border-l border-border">
                  <Input
                    className={`${inputCell} flex-1 min-w-0`}
                    value={l.value}
                    onChange={(e) => updateLabel(i, "value", e.target.value)}
                    placeholder="value"
                    disabled={!canEdit}
                  />
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                      onClick={() => removeLabel(i)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="py-8 text-center text-muted-foreground text-sm">No labels</div>
      )}
    </div>
  );
}
