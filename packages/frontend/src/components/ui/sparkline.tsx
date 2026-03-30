interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
}

export function Sparkline({
  data,
  width = 200,
  height = 32,
  color = "currentColor",
  fillOpacity = 0.1,
  className,
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stroke = 1.5;
  const top = stroke; // reserve space for stroke at peak

  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * width;
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
