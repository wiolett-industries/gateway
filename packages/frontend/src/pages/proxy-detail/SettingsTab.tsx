import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AccessList, CustomHeader, ProxyHost, RewriteRule } from "@/types";
import { ToggleRow } from "./helpers";

export interface SettingsTabProps {
  host: ProxyHost;
  onToggle: (field: string, value: boolean) => void;
  customHeaders: CustomHeader[];
  setCustomHeaders: (v: CustomHeader[]) => void;
  cacheEnabled: boolean;
  setCacheEnabled: (v: boolean) => void;
  cacheMaxAge: number;
  setCacheMaxAge: (v: number) => void;
  rateLimitEnabled: boolean;
  setRateLimitEnabled: (v: boolean) => void;
  rateLimitRPS: number;
  setRateLimitRPS: (v: number) => void;
  rateLimitBurst: number;
  setRateLimitBurst: (v: number) => void;
  customRewrites: RewriteRule[];
  setCustomRewrites: (v: RewriteRule[]) => void;
  onSaveCustom: () => void;
  isSavingCustom: boolean;
  accessListId: string;
  accessLists: AccessList[];
  onAccessListChange: (v: string) => void;
  canManage: boolean;
  hasHeadersChanged: boolean;
  hasRewritesChanged: boolean;
  healthCheckUrl: string;
  setHealthCheckUrl: (v: string) => void;
  healthCheckExpectedStatus: number | null;
  setHealthCheckExpectedStatus: (v: number | null) => void;
  healthCheckExpectedBody: string;
  setHealthCheckExpectedBody: (v: string) => void;
  healthCheckBodyMatchMode: "includes" | "exact" | "starts_with" | "ends_with";
  setHealthCheckBodyMatchMode: (v: "includes" | "exact" | "starts_with" | "ends_with") => void;
  healthCheckSlowThreshold: number;
  setHealthCheckSlowThreshold: (v: number) => void;
}

export function SettingsTab({
  host,
  onToggle,
  customHeaders,
  setCustomHeaders,
  cacheEnabled,
  setCacheEnabled,
  cacheMaxAge,
  setCacheMaxAge,
  rateLimitEnabled,
  setRateLimitEnabled,
  rateLimitRPS,
  setRateLimitRPS,
  rateLimitBurst,
  setRateLimitBurst,
  customRewrites,
  setCustomRewrites,
  onSaveCustom,
  isSavingCustom,
  accessListId,
  accessLists,
  onAccessListChange,
  canManage,
  hasHeadersChanged,
  hasRewritesChanged,
  healthCheckUrl,
  setHealthCheckUrl,
  healthCheckExpectedStatus,
  setHealthCheckExpectedStatus,
  healthCheckExpectedBody,
  setHealthCheckExpectedBody,
  healthCheckBodyMatchMode,
  setHealthCheckBodyMatchMode,
  healthCheckSlowThreshold,
  setHealthCheckSlowThreshold,
}: SettingsTabProps) {
  return (
    <div className="space-y-4">
      {/* WebSocket + Access List -- side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {host.type === "proxy" && (
          <div className="border border-border bg-card">
            <ToggleRow
              label="WebSocket Support"
              description="Enable WebSocket proxying"
              checked={host.websocketSupport}
              onChange={(v) => onToggle("websocketSupport", v)}
            />
          </div>
        )}
        <div
          className={cn("border border-border bg-card", host.type !== "proxy" && "md:col-span-2")}
        >
          <div className="flex items-center justify-between p-4">
            <div>
              <h2 className="font-semibold text-sm">Access List</h2>
              <p className="text-xs text-muted-foreground">
                Restrict access via IP rules or basic authentication
              </p>
            </div>
            <Select
              value={accessListId || "__none__"}
              onValueChange={(v) => onAccessListChange(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="w-48 shrink-0">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {accessLists.map((al) => (
                  <SelectItem key={al.id} value={al.id}>
                    {al.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* SSL */}
      <div className="border border-border bg-card">
        <ToggleRow
          label="SSL Enabled"
          description="Serve this host over HTTPS"
          checked={host.sslEnabled}
          onChange={(v) => onToggle("sslEnabled", v)}
        />
        <div className="border-t border-border grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          <ToggleRow
            label="Force HTTPS"
            description="Redirect HTTP to HTTPS"
            checked={host.sslForced}
            onChange={(v) => onToggle("sslForced", v)}
            disabled={!host.sslEnabled}
          />
          <ToggleRow
            label="HTTP/2"
            description="Enable HTTP/2 protocol support"
            checked={host.http2Support}
            onChange={(v) => onToggle("http2Support", v)}
            disabled={!host.sslEnabled}
          />
        </div>
      </div>

      {/* Cache & Rate Limit -- side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border bg-card">
          <div className="divide-y divide-border">
            <ToggleRow
              label="Cache"
              description="Enable response caching"
              checked={cacheEnabled}
              onChange={setCacheEnabled}
            />
            <div className="px-4 py-3">
              <label className="text-xs font-medium text-muted-foreground">Max Age (seconds)</label>
              <NumericInput
                value={cacheMaxAge}
                onChange={(v) => setCacheMaxAge(v)}
                min={1}
                className="mt-1"
                disabled={!cacheEnabled}
              />
            </div>
          </div>
        </div>
        <div className="border border-border bg-card">
          <div className="divide-y divide-border">
            <ToggleRow
              label="Rate Limit"
              description="Enable request rate limiting"
              checked={rateLimitEnabled}
              onChange={setRateLimitEnabled}
            />
            <div className="px-4 py-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Requests/sec</label>
                <NumericInput
                  value={rateLimitRPS}
                  onChange={setRateLimitRPS}
                  min={1}
                  disabled={!rateLimitEnabled}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Burst</label>
                <NumericInput
                  value={rateLimitBurst}
                  onChange={setRateLimitBurst}
                  min={1}
                  disabled={!rateLimitEnabled}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Health Check */}
      {host.type !== "404" && (
        <div className="border border-border bg-card">
          <ToggleRow
            label="Health Check"
            description="Enable periodic health monitoring"
            checked={host.healthCheckEnabled}
            onChange={(v) => onToggle("healthCheckEnabled", v)}
          />
          <div className="border-t border-border px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">URL Path</label>
              <Input
                value={healthCheckUrl}
                onChange={(e) => setHealthCheckUrl(e.target.value)}
                placeholder="/"
                disabled={!host.healthCheckEnabled}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Expected Status</label>
              <Input
                type="number"
                value={healthCheckExpectedStatus ?? ""}
                onChange={(e) =>
                  setHealthCheckExpectedStatus(e.target.value ? Number(e.target.value) : null)
                }
                placeholder="Any 2xx"
                disabled={!host.healthCheckEnabled}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Slow Threshold (Nx avg)
              </label>
              <Input
                type="number"
                min={0}
                value={healthCheckSlowThreshold}
                onChange={(e) => setHealthCheckSlowThreshold(Number(e.target.value) || 0)}
                placeholder="3"
                disabled={!host.healthCheckEnabled}
              />
              <p className="text-[10px] text-muted-foreground">
                Mark degraded when response time exceeds Nx the 3-hour average. 0 to disable.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Expected Body</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                <Select
                  value={healthCheckBodyMatchMode}
                  onValueChange={(v) =>
                    setHealthCheckBodyMatchMode(
                      v as "includes" | "exact" | "starts_with" | "ends_with"
                    )
                  }
                  disabled={!host.healthCheckEnabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="includes">Includes</SelectItem>
                    <SelectItem value="exact">Exact Match</SelectItem>
                    <SelectItem value="starts_with">Starts With</SelectItem>
                    <SelectItem value="ends_with">Ends With</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={healthCheckExpectedBody}
                  onChange={(e) => setHealthCheckExpectedBody(e.target.value)}
                  placeholder="Optional"
                  disabled={!host.healthCheckEnabled}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Headers */}
      <div className="border border-border bg-card">
        <div
          className={cn(
            "flex items-center justify-between p-4",
            customHeaders.length > 0 && "border-b border-border"
          )}
        >
          <div>
            <h2 className="font-semibold text-sm">Custom Headers</h2>
            <p className="text-xs text-muted-foreground">
              Add custom HTTP headers to proxied requests
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => setCustomHeaders([...customHeaders, { name: "", value: "" }])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={onSaveCustom}
                  disabled={!hasHeadersChanged || isSavingCustom}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              </>
            )}
          </div>
        </div>
        <motion.div
          animate={{ height: customHeaders.length > 0 ? "auto" : 0 }}
          initial={false}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="overflow-hidden"
        >
          <div className="p-4 space-y-3">
            <AnimatePresence initial={false}>
              {customHeaders.map((header, i) => (
                <motion.div
                  key={`header-${i}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="flex gap-2"
                >
                  <Input
                    placeholder="Header name"
                    value={header.name}
                    onChange={(e) => {
                      const next = [...customHeaders];
                      next[i] = { ...next[i], name: e.target.value };
                      setCustomHeaders(next);
                    }}
                  />
                  <Input
                    placeholder="Value"
                    value={header.value}
                    onChange={(e) => {
                      const next = [...customHeaders];
                      next[i] = { ...next[i], value: e.target.value };
                      setCustomHeaders(next);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCustomHeaders(customHeaders.filter((_, j) => j !== i))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* URL Rewrites */}
      <div className="border border-border bg-card">
        <div
          className={cn(
            "flex items-center justify-between p-4",
            customRewrites.length > 0 && "border-b border-border"
          )}
        >
          <div>
            <h2 className="font-semibold text-sm">URL Rewrites</h2>
            <p className="text-xs text-muted-foreground">Rewrite request paths before proxying</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() =>
                    setCustomRewrites([
                      ...customRewrites,
                      { source: "", destination: "", type: "permanent" },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={onSaveCustom}
                  disabled={!hasRewritesChanged || isSavingCustom}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              </>
            )}
          </div>
        </div>
        <motion.div
          animate={{ height: customRewrites.length > 0 ? "auto" : 0 }}
          initial={false}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="overflow-hidden"
        >
          <div className="p-4 space-y-3">
            <AnimatePresence initial={false}>
              {customRewrites.map((rule, i) => (
                <motion.div
                  key={`rewrite-${i}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="flex gap-2"
                >
                  <Input
                    placeholder="Source path"
                    value={rule.source}
                    onChange={(e) => {
                      const next = [...customRewrites];
                      next[i] = { ...next[i], source: e.target.value };
                      setCustomRewrites(next);
                    }}
                  />
                  <Input
                    placeholder="Destination"
                    value={rule.destination}
                    onChange={(e) => {
                      const next = [...customRewrites];
                      next[i] = { ...next[i], destination: e.target.value };
                      setCustomRewrites(next);
                    }}
                  />
                  <Select
                    value={rule.type}
                    onValueChange={(v) => {
                      const next = [...customRewrites];
                      next[i] = { ...next[i], type: v as "permanent" | "temporary" };
                      setCustomRewrites(next);
                    }}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="permanent">Permanent</SelectItem>
                      <SelectItem value="temporary">Temporary</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCustomRewrites(customRewrites.filter((_, j) => j !== i))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
