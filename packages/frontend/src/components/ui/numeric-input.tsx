import * as React from "react";
import { cn } from "@/lib/utils";

interface NumericInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: number;
  onChange: (value: number, raw: string) => void;
  min?: number;
  max?: number;
}

/**
 * A numeric input that allows empty state (for editing) without
 * resetting to a default value. Reports both the parsed number
 * and the raw string so the parent can track validity.
 *
 * Shows a red border when the value is empty or out of range.
 */
const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ className, value, onChange, min, max, ...props }, ref) => {
    const [raw, setRaw] = React.useState(String(value));

    // Sync when value changes externally
    React.useEffect(() => {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed === value) return;
      setRaw(String(value));
    }, [value]);

    const parsed = parseInt(raw, 10);
    const isInvalid = raw.trim() === "" || isNaN(parsed) ||
      (min !== undefined && parsed < min) ||
      (max !== undefined && parsed > max);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newRaw = e.target.value;
      setRaw(newRaw);
      const num = parseInt(newRaw, 10);
      onChange(isNaN(num) ? value : num, newRaw);
    };

    return (
      <input
        ref={ref}
        type="number"
        value={raw}
        onChange={handleChange}
        min={min}
        max={max}
        className={cn(
          "flex h-11 w-full border bg-transparent px-3 py-1 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm",
          isInvalid
            ? "border-destructive focus-visible:ring-destructive"
            : "border-input focus-visible:ring-ring",
          className
        )}
        {...props}
      />
    );
  }
);
NumericInput.displayName = "NumericInput";

export { NumericInput };
