import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_BARS = 192;
const DEFAULT_BAR_WIDTH = 6; // px target per bar
const DEFAULT_BUCKET_MS = 5 * 60 * 1000; // 5 minutes

type BarStatus = "ok" | "warn" | "error" | "none";

export interface HealthBarsProps {
  /** Raw health check entries with timestamp + status */
  history?: Array<{ ts: string; status: string }>;
  /** Hourly health entries (node format) with hour key + healthy boolean */
  hourlyHistory?: Array<{ hour: string; healthy: boolean }>;
  /** Current status used for the rightmost bar when no data in that bucket */
  currentStatus?: string;
  /** Bucket duration in ms (default: 5 min) */
  bucketMs?: number;
  /** Target width per bar in px (default: 4) */
  barWidth?: number;
  /** Bar height class (default: h-6) */
  barHeight?: string;
  /** Show time labels below (default: true) */
  showLabels?: boolean;
  className?: string;
}

export function HealthBars({
  history,
  hourlyHistory,
  currentStatus,
  bucketMs = DEFAULT_BUCKET_MS,
  barWidth = DEFAULT_BAR_WIDTH,
  barHeight = "h-6",
  showLabels = true,
  className,
}: HealthBarsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [barCount, setBarCount] = useState(0);

  // Measure container width and compute bar count
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const width = el.clientWidth;
      // Each bar takes barWidth + 1px gap
      const count = Math.min(MAX_BARS, Math.max(1, Math.floor(width / (barWidth + 1))));
      setBarCount(count);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [barWidth]);

  // Snap to bucket boundary so bars don't shift on every render
  const now = Math.floor(Date.now() / bucketMs) * bucketMs + bucketMs;

  const bars = useMemo(() => {
    if (barCount === 0) return [];

    // Node hourly format
    if (hourlyHistory) {
      const historyMap = new Map(hourlyHistory.map((h) => [h.hour, h.healthy]));
      const result: BarStatus[] = [];
      const interval = bucketMs;

      for (let i = barCount - 1; i >= 0; i--) {
        const d = new Date(now - i * interval);
        const hourKey = `${d.toISOString().slice(0, 13)}:00:00.000Z`;
        const status = historyMap.get(hourKey);
        result.push(status === true ? "ok" : status === false ? "error" : "none");
      }
      return result;
    }

    // Raw check format (proxy hosts)
    const checks = history ?? [];
    const result: BarStatus[] = [];

    for (let i = barCount - 1; i >= 0; i--) {
      const bucketStart = now - (i + 1) * bucketMs;
      const bucketEnd = now - i * bucketMs;

      const inBucket = checks.filter((c) => {
        const t = new Date(c.ts).getTime();
        return t >= bucketStart && t < bucketEnd;
      });

      if (inBucket.length === 0) {
        result.push("none");
      } else {
        const last = inBucket[inBucket.length - 1];
        const lastOk = last.status === "online";
        const hadErrors = inBucket.some((c) => c.status === "offline" || c.status === "degraded");
        result.push(lastOk ? (hadErrors ? "warn" : "ok") : "error");
      }
    }

    // Fill trailing empty bars with current status color
    if (currentStatus && currentStatus !== "unknown" && currentStatus !== "disabled") {
      const fill: BarStatus = currentStatus === "online" ? "ok" : "error";
      for (let j = result.length - 1; j >= 0; j--) {
        if (result[j] !== "none") break;
        result[j] = fill;
      }
    }

    return result;
  }, [history, hourlyHistory, barCount, now, currentStatus, bucketMs]);

  const totalMs = barCount * bucketMs;
  const totalHours = Math.round(totalMs / 3600000);
  const totalLabel =
    totalHours >= 1
      ? `${totalHours} hour${totalHours > 1 ? "s" : ""} ago`
      : `${Math.round(totalMs / 60000)} min ago`;

  return (
    <div ref={containerRef} className={cn("shrink-0", className)}>
      <div className="flex gap-[1px]">
        {bars.map((status, i) => (
          <div
            key={i}
            className={cn(
              "flex-1",
              barHeight,
              status === "ok"
                ? "bg-emerald-500"
                : status === "warn"
                  ? "bg-yellow-500"
                  : status === "error"
                    ? "bg-red-400"
                    : "bg-muted",
            )}
            title={new Date(now - (barCount - 1 - i) * bucketMs).toLocaleString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
        ))}
      </div>
      {showLabels && barCount > 0 && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
          <span>{totalLabel}</span>
          <span>Now</span>
        </div>
      )}
    </div>
  );
}
