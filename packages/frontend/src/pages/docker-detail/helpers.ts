import { toast } from "sonner";

export const STATUS_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  running: "success",
  exited: "secondary",
  stopped: "secondary",
  paused: "warning",
  dead: "destructive",
  restarting: "warning",
  stopping: "warning",
  recreating: "warning",
  updating: "warning",
  killing: "warning",
  created: "secondary",
};

export function containerDisplayName(name: string): string {
  return name.startsWith("/") ? name.slice(1) : name;
}

export function formatDate(ts: number | string): string {
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString();
}

export { formatBytes } from "@/lib/utils";

export function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Failed to copy")
  );
}

export type InspectData = Record<string, any>;
