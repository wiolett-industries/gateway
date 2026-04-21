import type { ReactNode } from "react";

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-4 px-4 py-3 md:grid-cols-[8rem_minmax(0,1fr)]">
      <span className="pt-0.5 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 justify-self-end text-right text-sm">{value}</span>
    </div>
  );
}
