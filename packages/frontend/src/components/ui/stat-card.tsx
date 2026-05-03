import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  history?: number[];
  color?: string;
  subtitle?: string;
  progress?: { percent: number; color?: string };
  sparklineMax?: number;
  /** Override text color for label and value (e.g. for warning state) */
  valueColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  history = [],
  color = "var(--color-primary)",
  subtitle,
  progress,
  sparklineMax,
  valueColor,
  className,
  style,
}: StatCardProps) {
  return (
    <div
      className={cn("border border-border bg-card flex flex-col overflow-hidden", className)}
      style={style}
    >
      <div className="p-4 space-y-2 flex-1">
        <div className="flex items-center justify-between">
          <p
            className="text-xs text-muted-foreground"
            style={valueColor ? { color: valueColor } : undefined}
          >
            {label}
          </p>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-xl font-bold" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </p>
        {progress && (
          <div className="w-full bg-muted h-1.5">
            <div
              className="h-1.5 transition-all"
              style={{
                width: `${Math.min(progress.percent, 100)}%`,
                backgroundColor: progress.color ?? color,
              }}
            />
          </div>
        )}
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
      {history.length >= 1 && (
        <Sparkline
          data={history}
          width={200}
          height={32}
          color={color}
          fillOpacity={0.1}
          className="w-full"
          maxValue={sparklineMax}
        />
      )}
    </div>
  );
}
