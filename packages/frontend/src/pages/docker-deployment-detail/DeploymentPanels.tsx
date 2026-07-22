import { ArrowRight, ClipboardCopy } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { DetailRow } from "@/components/common/DetailRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { api } from "@/services/api";
import type { DockerDeployment, DockerDeploymentRelease, DockerDeploymentSlot } from "@/types";
import { copyToClipboard, formatDate, STATUS_BADGE } from "../docker-detail/helpers";

export function statusVariant(
  status?: string
): "default" | "secondary" | "destructive" | "success" | "warning" {
  if (!status) return "secondary";
  if (STATUS_BADGE[status]) return STATUS_BADGE[status];
  if (status === "ready" || status === "healthy" || status === "succeeded") return "success";
  if (status === "failed" || status === "unhealthy") return "destructive";
  if (
    status === "deploying" ||
    status === "draining" ||
    status === "pending" ||
    status === "starting" ||
    status === "stopping" ||
    status === "restarting" ||
    status === "killing" ||
    status === "removing" ||
    status === "switching" ||
    status === "rolling_back"
  )
    return "warning";
  return "secondary";
}

function shortId(value?: string | null) {
  return value ? value.slice(0, 12) : "-";
}

function Section({
  title,
  badge,
  actions,
  active,
  children,
}: {
  title: string;
  badge?: string | number;
  actions?: React.ReactNode;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border border-border bg-card"
      style={active ? { borderColor: "#fff" } : undefined}
    >
      <div
        className={`flex items-center justify-between border-b border-border px-4 ${actions ? "py-3" : "py-4"}`}
      >
        <h2 className="font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {badge !== undefined && <Badge variant="secondary">{badge}</Badge>}
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}

export function DeploymentOverview({
  deployment,
  active,
  serviceState,
  activeState,
  primaryRoute,
}: {
  deployment: DockerDeployment;
  active: DockerDeploymentSlot | null;
  serviceState: string;
  activeState: string;
  primaryRoute: DockerDeployment["routes"][number] | null;
}) {
  return (
    <div className="space-y-4 pb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="General">
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Status"
              value={<Badge variant={statusVariant(serviceState)}>{serviceState}</Badge>}
            />
            <DetailRow
              label="Deployment ID"
              value={
                <button
                  type="button"
                  className="flex items-center gap-1.5 font-mono hover:text-primary cursor-pointer"
                  onClick={() => copyToClipboard(deployment.id)}
                >
                  {shortId(deployment.id)}
                  <ClipboardCopy className="h-3 w-3" />
                </button>
              }
            />
            <DetailRow
              label="Desired Image"
              value={<span className="font-mono">{deployment.desiredConfig.image}</span>}
            />
            <DetailRow
              label="Active Image"
              value={<span className="font-mono">{active?.image ?? "-"}</span>}
            />
            <DetailRow label="Created" value={formatDate(deployment.createdAt)} />
            <DetailRow label="Updated" value={formatDate(deployment.updatedAt)} />
          </div>
        </Section>

        <Section title="Active Slot">
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Slot"
              value={<span className="capitalize">{deployment.activeSlot}</span>}
            />
            <DetailRow
              label="Health"
              value={
                <Badge variant={statusVariant(active?.health)}>{active?.health ?? "unknown"}</Badge>
              }
            />
            <DetailRow
              label="Status"
              value={
                <Badge variant={statusVariant(active?.status)}>{active?.status ?? "unknown"}</Badge>
              }
            />
            <DetailRow label="Runtime" value={activeState} />
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Port Mappings" badge={deployment.routes.length}>
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            {deployment.routes.map((route) => (
              <DetailRow
                key={route.id}
                label={`0.0.0.0:${route.hostPort}`}
                value={
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">tcp/{route.containerPort}</span>
                    {route.isPrimary && (
                      <Badge variant="secondary" size="inline">
                        Primary
                      </Badge>
                    )}
                  </span>
                }
              />
            ))}
          </div>
        </Section>

        <Section title="Health Check">
          <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
            <DetailRow
              label="Path"
              value={<span className="font-mono">{deployment.healthConfig.path}</span>}
            />
            <DetailRow
              label="Status"
              value={
                <span className="font-mono">
                  {deployment.healthConfig.statusMin}-{deployment.healthConfig.statusMax}
                </span>
              }
            />
            <DetailRow label="Interval" value={`${deployment.healthConfig.intervalSeconds}s`} />
            <DetailRow label="Timeout" value={`${deployment.healthConfig.timeoutSeconds}s`} />
            <DetailRow label="Drain" value={`${deployment.drainSeconds}s`} />
            <DetailRow
              label="Primary"
              value={
                <span className="font-mono">
                  {primaryRoute ? `${primaryRoute.hostPort} -> ${primaryRoute.containerPort}` : "-"}
                </span>
              }
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

export function DeploymentSlots({
  deployment,
  nodeId,
  action,
  serviceBusy,
  runAction,
  canManage,
}: {
  deployment: DockerDeployment;
  nodeId: string;
  action: string | null;
  serviceBusy: boolean;
  runAction: (name: string, fn: () => Promise<void>) => Promise<void>;
  canManage: boolean;
}) {
  const orderedSlots = (["blue", "green"] as const)
    .map((slotName) => deployment.slots.find((slot) => slot.slot === slotName))
    .filter((slot): slot is DockerDeploymentSlot => Boolean(slot));

  return (
    <div className="space-y-4 pb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {orderedSlots.map((slot) => {
          const desiredImage = deployment.desiredConfig.image;
          const effectiveImage =
            slot.slot === deployment.activeSlot ? (slot.image ?? desiredImage) : desiredImage;

          return (
            <Section
              key={slot.slot}
              title={`${slot.slot[0].toUpperCase()}${slot.slot.slice(1)} Slot`}
              active={slot.slot === deployment.activeSlot}
              actions={
                canManage && slot.slot !== deployment.activeSlot ? (
                  <Button
                    disabled={!!action || serviceBusy || !slot.containerId}
                    onClick={() =>
                      runAction(`switch-${slot.slot}`, async () => {
                        await api.switchDockerDeployment(nodeId, deployment.id, slot.slot);
                        toast.success("Switched active slot");
                      })
                    }
                  >
                    Switch
                  </Button>
                ) : null
              }
            >
              <div className="divide-y divide-border -mb-px">
                <DetailRow
                  label="Role"
                  value={
                    <div className="flex justify-end gap-2">
                      {slot.slot === deployment.activeSlot && <Badge>Active</Badge>}
                      {slot.status === "draining" && <Badge variant="warning">Draining</Badge>}
                      {slot.slot !== deployment.activeSlot && slot.status !== "draining" && (
                        <Badge variant="secondary">Standby</Badge>
                      )}
                    </div>
                  }
                />
                <DetailRow
                  label="Status"
                  value={<Badge variant={statusVariant(slot.status)}>{slot.status}</Badge>}
                />
                <DetailRow
                  label="Health"
                  value={<Badge variant={statusVariant(slot.health)}>{slot.health}</Badge>}
                />
                <div
                  className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-4 border-b border-border px-4 py-3 md:grid-cols-[8rem_minmax(0,1fr)]"
                  style={
                    slot.slot === deployment.activeSlot ? { borderBottomColor: "#fff" } : undefined
                  }
                >
                  <span className="pt-0.5 text-sm text-muted-foreground">Image</span>
                  <span className="min-w-0 justify-self-end text-right text-sm">
                    <span className="font-mono break-all">{effectiveImage}</span>
                  </span>
                </div>
              </div>
            </Section>
          );
        })}
      </div>

      <Section title="Recent Activity" badge={deployment.releases.length}>
        <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
          {deployment.releases.map((release) => (
            <ReleaseRow key={release.id} release={release} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function ReleaseRow({ release }: { release: DockerDeploymentRelease }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm capitalize">{release.triggerSource}</span>
          <span className="inline-flex min-w-0 items-center text-sm text-muted-foreground">
            {release.fromSlot ?? "-"}
            <ArrowRight className="mx-1.5 h-3.5 w-3.5 shrink-0" />
            {release.toSlot ?? "-"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">{release.image ?? "-"}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        <Badge variant={statusVariant(release.status)} size="inline">
          {release.status}
        </Badge>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDate(release.createdAt)}
        </span>
      </div>
    </div>
  );
}

export function DeploymentConfig({ deployment }: { deployment: DockerDeployment }) {
  const jsonText = useMemo(
    () =>
      JSON.stringify(
        {
          id: deployment.id,
          name: deployment.name,
          status: deployment.status,
          activeSlot: deployment.activeSlot,
          desiredConfig: deployment.desiredConfig,
          routes: deployment.routes,
          healthConfig: deployment.healthConfig,
          drainSeconds: deployment.drainSeconds,
          routerName: deployment.routerName,
          routerImage: deployment.routerImage,
          networkName: deployment.networkName,
          slots: deployment.slots.map((slot) => ({
            slot: slot.slot,
            image: slot.image,
            status: slot.status,
            health: slot.health,
            drainingUntil: slot.drainingUntil,
            updatedAt: slot.updatedAt,
          })),
        },
        null,
        2
      ),
    [deployment]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border border-border border-b-0 bg-card">
          <div>
            <h3 className="text-sm font-semibold">Deployment Config</h3>
            <p className="text-xs text-muted-foreground">Service-level configuration</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => copyToClipboard(jsonText)}
            title="Copy JSON"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <CodeEditor value={jsonText} onChange={() => {}} readOnly language="json" />
        </div>
      </div>
    </div>
  );
}
