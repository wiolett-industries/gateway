interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
  /** Floor value for the Y axis. Defaults to 0 so low values don't hug the bottom. */
  minValue?: number;
  /** Ceiling value for the Y axis. Useful for metrics with a known max (e.g., total memory). */
  maxValue?: number;
}

export function Sparkline({
  data,
  width = 200,
  height = 32,
  color = "currentColor",
  fillOpacity = 0.1,
  className,
  minValue = 0,
  maxValue,
}: SparklineProps) {
  if (data.length === 0) return null;
  const values = data.length === 1 ? [data[0]!, data[0]!] : data;

  const min = Math.min(minValue, ...values);
  const max = maxValue != null ? Math.max(maxValue, ...values) : Math.max(...values);
  const range = max - min || 1;
  const stroke = 1.5;
  const top = stroke; // reserve space for stroke at peak

  const points = values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = top + (height - top) - ((value - min) / range) * (height - top);
      return `${x},${y}`;
    })
    .join(" ");

  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ display: "block", height }}
    >
      <polyline points={fillPoints} fill={color} fillOpacity={fillOpacity} stroke="none" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
