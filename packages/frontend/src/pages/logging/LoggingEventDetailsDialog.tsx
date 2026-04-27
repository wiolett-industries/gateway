import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LoggingSearchResult } from "@/types";

export function LoggingEventDetailsDialog({
  event,
  onOpenChange,
}: {
  event: LoggingSearchResult | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Log Event</DialogTitle>
        </DialogHeader>
        {event && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{event.severity}</Badge>
              <span className="text-sm text-muted-foreground">
                {new Date(event.timestamp).toLocaleString()}
              </span>
              {event.service && <Badge variant="secondary">{event.service}</Badge>}
              {event.source && <Badge variant="secondary">{event.source}</Badge>}
            </div>
            <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
              {event.message}
            </pre>
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <Detail label="Trace ID" value={event.traceId} />
              <Detail label="Span ID" value={event.spanId} />
              <Detail label="Request ID" value={event.requestId} />
            </div>
            <JsonBlock title="Labels" value={event.labels} />
            <JsonBlock title="Fields" value={event.fields} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-xs">{value || "-"}</p>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
