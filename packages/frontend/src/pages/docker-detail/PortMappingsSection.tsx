import { Minus, Plus } from "lucide-react";
import { PanelShell } from "@/components/common/PanelShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface PortMapping {
  hostPort: string;
  containerPort: string;
  protocol: "tcp" | "udp";
}

interface PortMappingsSectionProps {
  canEdit: boolean;
  ports: PortMapping[];
  setPorts: React.Dispatch<React.SetStateAction<PortMapping[]>>;
  portsChanged: boolean;
  inputCell: string;
  showProtocol?: boolean;
}

export function PortMappingsSection({
  canEdit,
  ports,
  setPorts,
  portsChanged,
  inputCell,
  showProtocol = true,
}: PortMappingsSectionProps) {
  const addPort = () =>
    setPorts((p) => [...p, { hostPort: "", containerPort: "", protocol: "tcp" }]);
  const removePort = (i: number) => setPorts((p) => p.filter((_, idx) => idx !== i));
  const updatePort = (i: number, field: keyof PortMapping, val: string) =>
    setPorts((p) => p.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry)));
  const gridColumns = showProtocol
    ? canEdit
      ? "grid-cols-[1fr_1fr_100px_36px]"
      : "grid-cols-[1fr_1fr_100px]"
    : canEdit
      ? "grid-cols-[1fr_1fr_36px]"
      : "grid-cols-[1fr_1fr]";

  return (
    <PanelShell
      title="Port Mappings"
      description="Requires container recreation"
      dirty={portsChanged}
      actions={
        canEdit ? (
          <Button size="sm" onClick={addPort}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        ) : null
      }
    >
      {ports.length > 0 ? (
        <>
          <div
            className={`grid ${gridColumns} border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider`}
          >
            <div className="px-3 py-2">Host Port</div>
            <div className="px-3 py-2 border-l border-border">Container Port</div>
            {showProtocol && <div className="px-3 py-2 border-l border-border">Protocol</div>}
            {canEdit && <div />}
          </div>
          <div>
            {ports.map((p, i) => (
              <div key={i} className={`grid ${gridColumns} border-b border-border last:border-b-0`}>
                <Input
                  type="number"
                  className={inputCell}
                  value={p.hostPort}
                  onChange={(e) => updatePort(i, "hostPort", e.target.value)}
                  placeholder="8080"
                  disabled={!canEdit}
                />
                <div className="border-l border-border">
                  <Input
                    type="number"
                    className={inputCell}
                    value={p.containerPort}
                    onChange={(e) => updatePort(i, "containerPort", e.target.value)}
                    placeholder="80"
                    disabled={!canEdit}
                  />
                </div>
                {showProtocol && (
                  <div className="border-l border-border">
                    <Select
                      value={p.protocol}
                      onValueChange={(v) => updatePort(i, "protocol", v)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="h-9 text-xs border-0 rounded-none shadow-none focus:ring-1 focus:ring-inset focus:ring-ring">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tcp">TCP</SelectItem>
                        <SelectItem value="udp">UDP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                    onClick={() => removePort(i)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="py-8 text-center text-muted-foreground text-sm">No port mappings</div>
      )}
    </PanelShell>
  );
}
