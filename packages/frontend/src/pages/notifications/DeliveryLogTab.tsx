import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import type { WebhookDelivery } from "@/types";

export const DELIVERY_PAGE_SIZE = 100;

const SEV_BADGE: Record<string, "warning" | "destructive" | "secondary"> = {
  info: "secondary",
  warning: "warning",
  critical: "destructive",
};

const STATUS_BADGE: Record<string, "success" | "destructive" | "warning" | "secondary"> = {
  success: "success",
  failed: "destructive",
  retrying: "warning",
  pending: "secondary",
};

export function DeliveryLogTab({ refreshToken }: { refreshToken: number }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>(
    () => api.getCached<WebhookDelivery[]>("notifications:deliveries:all") ?? []
  );
  const [isLoading, setIsLoading] = useState(
    () => api.getCached<WebhookDelivery[]>("notifications:deliveries:all") === undefined
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [detail, setDetail] = useState<WebhookDelivery | null>(null);
  const [detailLoadFailed, setDetailLoadFailed] = useState(false);
  const pageRef = useRef(0);
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (resetTo: WebhookDelivery[] | null) => {
      const nextPage = resetTo ? 1 : pageRef.current + 1;
      const requestId = ++requestIdRef.current;
      const cacheKey = `notifications:deliveries:${statusFilter}`;
      if (resetTo) {
        const cached = api.getCached<WebhookDelivery[]>(cacheKey);
        if (cached) {
          pageRef.current = 1;
          setDeliveries(cached);
          setIsLoading(false);
          setHasMore(api.getCached<boolean>(`${cacheKey}:has-more`) ?? true);
        } else {
          pageRef.current = 0;
          setDeliveries([]);
          setIsLoading(true);
          setHasMore(true);
        }
      } else {
        setLoadingMore(true);
      }
      try {
        const result = await api.listDeliveries({
          page: nextPage,
          limit: DELIVERY_PAGE_SIZE,
          status: statusFilter !== "all" ? statusFilter : undefined,
        });
        if (requestId !== requestIdRef.current) return;
        const fetched = result.data || [];
        const totalPages = result.totalPages ?? 1;
        pageRef.current = nextPage;
        setDeliveries((prev) => {
          const next = resetTo ? fetched : [...prev, ...fetched];
          if (resetTo) {
            api.setCache(cacheKey, next);
            api.setCache(`${cacheKey}:has-more`, nextPage < totalPages);
          }
          return next;
        });
        setHasMore(nextPage < totalPages);
      } catch {
        toast.error("Failed to load deliveries");
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [statusFilter]
  );

  const openDeliveryDetail = async (delivery: WebhookDelivery) => {
    const requestId = ++detailRequestIdRef.current;
    setDetailLoadFailed(false);
    setDetail(delivery);
    try {
      const full = await api.getDelivery(delivery.id);
      if (requestId !== detailRequestIdRef.current) return;
      setDetail(full);
    } catch {
      if (requestId !== detailRequestIdRef.current) return;
      setDetailLoadFailed(true);
      toast.error("Failed to load delivery details");
    }
  };

  useEffect(() => {
    pageRef.current = 0;
    fetchPage([]);
  }, [fetchPage]);

  useEffect(() => {
    if (refreshToken > 0) {
      pageRef.current = 0;
      void fetchPage([]);
    }
  }, [fetchPage, refreshToken]);

  useRealtime("alert.fired", () => {
    pageRef.current = 0;
    void fetchPage([]);
  });

  useRealtime("alert.resolved", () => {
    pageRef.current = 0;
    void fetchPage([]);
  });

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !isLoading) {
          void fetchPage(null);
        }
      },
      { root, rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchPage, hasMore, loadingMore, isLoading]);

  const sIcon = (s: string) => {
    if (s === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (s === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
    return <Clock className="h-4 w-4 text-amber-500" />;
  };

  const filteredDeliveries = useMemo(() => {
    if (!search) return deliveries;
    const q = search.toLowerCase();
    return deliveries.filter((delivery) =>
      [
        delivery.webhookName,
        delivery.webhookId,
        delivery.eventType,
        delivery.severity,
        delivery.responseStatus != null ? String(delivery.responseStatus) : "",
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [deliveries, search]);

  if (isLoading && deliveries.length === 0) return <LoadingSpinner />;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-4">
      <SearchFilterBar
        placeholder="Search by webhook, event, severity, or HTTP status..."
        search={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={() => setSearch(searchInput)}
        hasActiveFilters={statusFilter !== "all" || search !== ""}
        onReset={() => {
          setSearchInput("");
          setSearch("");
          setStatusFilter("all");
        }}
        filters={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="retrying">Retrying</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {deliveries.length === 0 ? (
        <EmptyState message="No deliveries yet. Delivery attempts will appear here when alerts fire." />
      ) : (
        <div className="min-w-0 border border-border bg-card">
          <div ref={scrollRef} className="max-h-[calc(100vh-18rem)] overflow-auto -mb-px">
            <table className="w-full min-w-[56rem]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground w-10" />
                  <th className="p-3 text-xs font-medium text-muted-foreground">Webhook</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Event</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Severity</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">HTTP</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Attempt</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDeliveries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">
                      No deliveries match the current search.
                    </td>
                  </tr>
                ) : (
                  filteredDeliveries.map((d) => (
                    <tr
                      key={d.id}
                      className="hover:bg-accent transition-colors cursor-pointer"
                      onClick={() => void openDeliveryDetail(d)}
                    >
                      <td className="p-3">{sIcon(d.status)}</td>
                      <td className="p-3">
                        <span className="text-sm font-medium">
                          {d.webhookName ?? d.webhookId.slice(0, 8)}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-sm font-mono text-muted-foreground">
                          {d.eventType}
                        </span>
                      </td>
                      <td className="p-3">
                        <Badge variant={SEV_BADGE[d.severity] ?? "secondary"}>{d.severity}</Badge>
                      </td>
                      <td className="p-3">
                        {d.responseStatus ? (
                          <Badge variant={d.responseStatus < 300 ? "success" : "destructive"}>
                            {d.responseStatus}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-sm text-muted-foreground">
                          {d.responseTimeMs != null ? `${d.responseTimeMs}ms` : "—"}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-sm text-muted-foreground">
                          {d.attempt}/{d.maxAttempts}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-muted-foreground">
                          {new Date(d.createdAt).toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8}>
                    <div
                      ref={sentinelRef}
                      className="py-4 text-center text-xs text-muted-foreground"
                    >
                      {loadingMore
                        ? "Loading more..."
                        : !hasMore && deliveries.length > 0
                          ? "End of log"
                          : ""}
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {detail && (
        <Dialog
          open={!!detail}
          onOpenChange={() => {
            detailRequestIdRef.current++;
            setDetailLoadFailed(false);
            setDetail(null);
          }}
        >
          <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Delivery Details</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant={STATUS_BADGE[detail.status]}>{detail.status}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Event:</span> {detail.eventType}
                </div>
                <div>
                  <span className="text-muted-foreground">HTTP:</span>{" "}
                  {detail.responseStatus ? (
                    <Badge variant={detail.responseStatus < 300 ? "success" : "destructive"}>
                      {detail.responseStatus}
                    </Badge>
                  ) : (
                    "N/A"
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Time:</span>{" "}
                  {detail.responseTimeMs != null ? `${detail.responseTimeMs}ms` : "N/A"}
                </div>
                <div>
                  <span className="text-muted-foreground">Attempt:</span> {detail.attempt}/
                  {detail.maxAttempts}
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  {new Date(detail.createdAt).toLocaleString()}
                </div>
              </div>
              {detail.error && (
                <div>
                  <p className="text-sm font-medium mb-1">Error</p>
                  <pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap">
                    {detail.error}
                  </pre>
                </div>
              )}
              {(detail.requestBody ?? detail.requestBodyPreview) && (
                <div>
                  <p className="text-sm font-medium mb-1">Request Body</p>
                  <pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap max-h-[200px] overflow-auto font-mono">
                    {detail.requestBody ?? detail.requestBodyPreview}
                  </pre>
                  {!detail.requestBody && detail.requestBodyTruncated && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {detailLoadFailed
                        ? "Preview truncated. Full details could not be loaded."
                        : "Preview truncated. Loading full details..."}
                    </p>
                  )}
                </div>
              )}
              {(detail.responseBody ?? detail.responseBodyPreview) && (
                <div>
                  <p className="text-sm font-medium mb-1">Response Body</p>
                  <pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap max-h-[200px] overflow-auto font-mono">
                    {detail.responseBody ?? detail.responseBodyPreview}
                  </pre>
                  {!detail.responseBody && detail.responseBodyTruncated && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {detailLoadFailed
                        ? "Preview truncated. Full details could not be loaded."
                        : "Preview truncated. Loading full details..."}
                    </p>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
