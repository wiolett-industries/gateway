import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes } from "@/lib/utils";

interface RuntimeSectionProps {
  canEdit: boolean;
  appliesLive: boolean;
  restartPolicy: string;
  setRestartPolicy: (v: string) => void;
  maxRetries: string;
  setMaxRetries: (v: string) => void;
  memoryMB: string;
  setMemoryMB: (v: string) => void;
  memSwapMB: string;
  setMemSwapMB: (v: string) => void;
  cpuCount: string;
  setCpuCount: (v: string) => void;
  cpuShares: string;
  setCpuShares: (v: string) => void;
  pidsLimit: string;
  setPidsLimit: (v: string) => void;
  maxMemoryBytes: number | null;
  maxSwapBytes: number | null;
  maxCpuCount: number | null;
  runtimeValidationError: string | null;
  hasRuntimeChanges: boolean;
  liveLoading: boolean;
  onApply: () => void;
}

export function RuntimeSection({
  canEdit,
  appliesLive,
  restartPolicy,
  setRestartPolicy,
  maxRetries,
  setMaxRetries,
  memoryMB,
  setMemoryMB,
  memSwapMB,
  setMemSwapMB,
  cpuCount,
  setCpuCount,
  cpuShares,
  setCpuShares,
  pidsLimit,
  setPidsLimit,
  maxMemoryBytes,
  maxSwapBytes,
  maxCpuCount,
  runtimeValidationError,
  hasRuntimeChanges,
  liveLoading,
  onApply,
}: RuntimeSectionProps) {
  const maxMemoryMB =
    maxMemoryBytes && maxMemoryBytes > 0 ? Math.floor(maxMemoryBytes / 1048576) : null;
  const maxSwapMB = maxSwapBytes && maxSwapBytes > 0 ? Math.floor(maxSwapBytes / 1048576) : null;

  return (
    <div className="border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Runtime Settings</h3>
          <p className="text-xs text-muted-foreground">
            {appliesLive
              ? "Applied instantly without restart"
              : "Saved with container configuration"}
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={onApply}
            disabled={liveLoading || !hasRuntimeChanges || !!runtimeValidationError}
          >
            <Save className="h-3.5 w-3.5" />
            {appliesLive ? "Apply" : "Save"}
          </Button>
        )}
      </div>
      <div className="p-4 space-y-4">
        {hasRuntimeChanges && runtimeValidationError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {runtimeValidationError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Restart Policy</label>
            <Select value={restartPolicy} onValueChange={setRestartPolicy} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="unless-stopped">Unless Stopped</SelectItem>
                <SelectItem value="on-failure">On Failure</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {restartPolicy === "on-failure" ? "Max Retries" : "PIDs Limit"}
            </label>
            {restartPolicy === "on-failure" ? (
              <Input
                type="number"
                className="h-8 text-xs"
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                placeholder="0"
                disabled={!canEdit}
                min={0}
              />
            ) : (
              <Input
                type="number"
                className="h-8 text-xs"
                value={pidsLimit}
                onChange={(e) => setPidsLimit(e.target.value)}
                placeholder="Unlimited"
                disabled={!canEdit}
                min={0}
              />
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Memory Limit (MB)</label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={memoryMB}
              onChange={(e) => setMemoryMB(e.target.value)}
              placeholder="Unlimited"
              disabled={!canEdit}
              min={0}
              max={maxMemoryMB ?? undefined}
            />
            {maxMemoryBytes && maxMemoryBytes > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Max: {formatBytes(maxMemoryBytes)}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Swap (MB)</label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={memSwapMB}
              onChange={(e) => setMemSwapMB(e.target.value)}
              placeholder="-1 = unlimited, 0 = disabled"
              disabled={!canEdit}
              min={-1}
              max={maxSwapMB ?? undefined}
            />
            {maxSwapBytes && maxSwapBytes > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Max extra swap: {formatBytes(maxSwapBytes)}
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">CPU Limit (cores)</label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={cpuCount}
              onChange={(e) => setCpuCount(e.target.value)}
              placeholder="Unlimited"
              disabled={!canEdit}
              min={0}
              max={maxCpuCount ?? undefined}
              step={0.1}
            />
            {maxCpuCount && maxCpuCount > 0 && (
              <p className="text-[11px] text-muted-foreground">Max: {maxCpuCount} cores</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">CPU Shares</label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={cpuShares}
              onChange={(e) => setCpuShares(e.target.value)}
              placeholder="Default: 1024"
              disabled={!canEdit}
              min={0}
            />
          </div>
        </div>
        {restartPolicy === "on-failure" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">PIDs Limit</label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={pidsLimit}
              onChange={(e) => setPidsLimit(e.target.value)}
              placeholder="Unlimited"
              disabled={!canEdit}
              min={0}
            />
          </div>
        )}
      </div>
    </div>
  );
}
