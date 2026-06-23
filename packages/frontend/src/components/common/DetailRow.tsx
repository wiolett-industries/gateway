import type { ReactNode } from "react";

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-4 px-4 py-3 md:grid-cols-[8rem_minmax(0,1fr)]">
      <span className="flex h-6 items-center text-sm text-muted-foreground">{label}</span>
      <span className="flex h-6 min-w-0 items-center justify-self-end text-right text-sm">
        {value}
      </span>
    </div>
  );
}
