import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface MountEntry {
  hostPath: string;
  containerPath: string;
  name: string;
  readOnly: boolean;
}

interface VolumeMountsSectionProps {
  canEdit: boolean;
  mounts: MountEntry[];
  setMounts: React.Dispatch<React.SetStateAction<MountEntry[]>>;
  mountsChanged: boolean;
  inputCell: string;
}

export function VolumeMountsSection({
  canEdit,
  mounts,
  setMounts,
  mountsChanged,
  inputCell,
}: VolumeMountsSectionProps) {
  const addMount = () =>
    setMounts((m) => [...m, { hostPath: "", containerPath: "", name: "", readOnly: false }]);
  const removeMount = (i: number) => setMounts((m) => m.filter((_, idx) => idx !== i));
  const updateMount = (i: number, field: keyof MountEntry, val: string | boolean) =>
    setMounts((m) => m.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry)));

  return (
    <div
      className="border bg-card overflow-hidden"
      style={mountsChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Volume Mounts</h3>
          <p className="text-xs text-muted-foreground">Requires container recreation</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={addMount}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>
      {mounts.length > 0 ? (
        <>
          <div
            className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider`}
          >
            <div className="px-3 py-2">Source</div>
            <div className="px-3 py-2 border-l border-border">Container Path</div>
            <div className="px-3 py-2 border-l border-border">Mode</div>
            {canEdit && <div />}
          </div>
          <div>
            {mounts.map((m, i) => (
              <div
                key={i}
                className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border last:border-b-0`}
              >
                <Input
                  className={inputCell}
                  value={m.hostPath || m.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith("/")) {
                      updateMount(i, "hostPath", val);
                      updateMount(i, "name", "");
                    } else {
                      updateMount(i, "name", val);
                      updateMount(i, "hostPath", "");
                    }
                  }}
                  placeholder="/host/path or volume-name"
                  disabled={!canEdit}
                />
                <div className="border-l border-border">
                  <Input
                    className={inputCell}
                    value={m.containerPath}
                    onChange={(e) => updateMount(i, "containerPath", e.target.value)}
                    placeholder="/container/path"
                    disabled={!canEdit}
                  />
                </div>
                <div className="border-l border-border">
                  <Select
                    value={m.readOnly ? "ro" : "rw"}
                    onValueChange={(v) => updateMount(i, "readOnly", v === "ro")}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-9 text-xs border-0 rounded-none shadow-none focus:ring-1 focus:ring-inset focus:ring-ring">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rw">RW</SelectItem>
                      <SelectItem value="ro">RO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                    onClick={() => removeMount(i)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="py-8 text-center text-muted-foreground text-sm">No volume mounts</div>
      )}
    </div>
  );
}
