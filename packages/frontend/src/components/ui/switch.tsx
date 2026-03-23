import { cn } from "@/lib/utils";

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center transition-colors border border-border",
        checked ? "bg-primary" : "bg-muted-foreground/20"
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 bg-background transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
