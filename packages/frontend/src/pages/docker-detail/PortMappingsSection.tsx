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
}

export function PortMappingsSection({
  canEdit,
  ports,
  setPorts,
  portsChanged,
  inputCell,
}: PortMappingsSectionProps) {
  const addPort = () =>
    setPorts((p) => [...p, { hostPort: "", containerPort: "", protocol: "tcp" }]);
  const removePort = (i: number) => setPorts((p) => p.filter((_, idx) => idx !== i));
  const updatePort = (i: number, field: keyof PortMapping, val: string) =>
    setPorts((p) => p.map((entry, idx) => (idx === i ? { ...entry, [field]: val } : entry)));

  return (
    <div
      className="border bg-card overflow-hidden"
      style={portsChanged ? { borderColor: "rgb(234 179 8)" } : undefined}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Port Mappings</h3>
          <p className="text-xs text-muted-foreground">Requires container recreation</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={addPort}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>
      {ports.length > 0 ? (
        <>
          <div
            className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider`}
          >
            <div className="px-3 py-2">Host Port</div>
            <div className="px-3 py-2 border-l border-border">Container Port</div>
            <div className="px-3 py-2 border-l border-border">Protocol</div>
            {canEdit && <div />}
          </div>
          <div>
            {ports.map((p, i) => (
              <div
                key={i}
                className={`grid ${canEdit ? "grid-cols-[1fr_1fr_100px_36px]" : "grid-cols-[1fr_1fr_100px]"} border-b border-border last:border-b-0`}
              >
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
    </div>
  );
}
