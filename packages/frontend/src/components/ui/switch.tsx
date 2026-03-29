import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center transition-colors border border-border",
        checked ? "bg-primary" : "bg-muted-foreground/20",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 bg-background transition-transform",
          checked ? "translate-x-[17px]" : "translate-x-px"
        )}
      />
    </button>
  );
}
