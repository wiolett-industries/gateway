import { ExternalLink, Globe, Lock, RefreshCw, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { DomainWithUsage } from "@/types";
import { DnsStatusBadge } from "./DnsStatusBadge";

interface DomainDetailDialogProps {
  domainId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

export function DomainDetailDialog({ domainId, open, onOpenChange, onUpdated }: DomainDetailDialogProps) {
  const { hasRole } = useAuthStore();
  const canEdit = hasRole("admin", "operator");
  const [domain, setDomain] = useState<DomainWithUsage | null>(null);
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingDns, setIsCheckingDns] = useState(false);
  const [isIssuingCert, setIsIssuingCert] = useState(false);

  useEffect(() => {
    if (!domainId || !open) return;
    setIsLoading(true);
    api
      .getDomain(domainId)
      .then((d) => {
        setDomain(d);
        setDescription(d.description || "");
      })
      .catch(() => toast.error("Failed to load domain"))
      .finally(() => setIsLoading(false));
  }, [domainId, open]);

  const handleSave = async () => {
    if (!domain) return;
    try {
      await api.updateDomain(domain.id, { description: description.trim() || null });
      toast.success("Domain updated");
      onUpdated();
    } catch {
      toast.error("Failed to update domain");
    }
  };

  const handleCheckDns = async () => {
    if (!domain) return;
    setIsCheckingDns(true);
    try {
      const updated = await api.checkDomainDns(domain.id);
      setDomain({ ...domain, ...updated, usage: domain.usage });
      toast.success("DNS check complete");
      onUpdated();
    } catch {
      toast.error("DNS check failed");
    } finally {
      setIsCheckingDns(false);
    }
  };

  const handleIssueCert = async () => {
    if (!domain) return;
    setIsIssuingCert(true);
    try {
      await api.issueDomainCert(domain.id);
      toast.success("Certificate issued");
      // Refresh to show new cert in usage
      const updated = await api.getDomain(domain.id);
      setDomain(updated);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue certificate");
    } finally {
      setIsIssuingCert(false);
    }
  };

  const records = domain?.dnsRecords;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {domain?.domain || "Loading..."}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : domain ? (
          <div className="space-y-5">
            {/* Description */}
            {canEdit && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <div className="flex gap-2">
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    className="flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={handleSave} disabled={description === (domain.description || "")}>
                    Save
                  </Button>
                </div>
              </div>
            )}

            <Separator />

            {/* DNS Status */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">DNS Status</h3>
                <Button size="sm" variant="outline" onClick={handleCheckDns} disabled={isCheckingDns}>
                  <RefreshCw className={`h-3.5 w-3.5 ${isCheckingDns ? "animate-spin" : ""}`} />
                  {isCheckingDns ? "Checking..." : "Check DNS"}
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <DnsStatusBadge status={domain.dnsStatus} />
                {domain.lastDnsCheckAt && (
                  <span className="text-xs text-muted-foreground">
                    Checked {formatRelativeDate(domain.lastDnsCheckAt)}
                  </span>
                )}
              </div>

              {records && (
                <div className="space-y-2 text-xs">
                  {records.a.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-12 shrink-0">A</span>
                      <span className="font-mono">{records.a.join(", ")}</span>
                    </div>
                  )}
                  {records.aaaa.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-12 shrink-0">AAAA</span>
                      <span className="font-mono">{records.aaaa.join(", ")}</span>
                    </div>
                  )}
                  {records.cname.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-12 shrink-0">CNAME</span>
                      <span className="font-mono">{records.cname.join(", ")}</span>
                    </div>
                  )}
                  {records.caa.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-12 shrink-0">CAA</span>
                      <span className="font-mono">
                        {records.caa.map((r) => r.issue || r.issuewild || "").filter(Boolean).join(", ") || "—"}
                      </span>
                    </div>
                  )}
                  {records.mx.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-12 shrink-0">MX</span>
                      <span className="font-mono">{records.mx.map((r) => `${r.priority} ${r.exchange}`).join(", ")}</span>
                    </div>
                  )}
                  {records.txt.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-12 shrink-0">TXT</span>
                      <span className="font-mono truncate">{records.txt.map((r) => r.join("")).slice(0, 3).join("; ")}{records.txt.length > 3 ? "..." : ""}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Usage */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Usage</h3>

              {domain.usage.proxyHosts.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Proxy Hosts</p>
                  {domain.usage.proxyHosts.map((ph) => (
                    <Link
                      key={ph.id}
                      to={`/proxy-hosts/${ph.id}`}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      <span>{ph.domainNames[0]}</span>
                      {!ph.enabled && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No proxy hosts use this domain</p>
              )}

              {domain.usage.sslCertificates.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">SSL Certificates</p>
                  {domain.usage.sslCertificates.map((cert) => (
                    <div key={cert.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                      <Lock className="h-3 w-3 text-muted-foreground" />
                      <span>{cert.domainNames[0]}</span>
                      <Badge variant={cert.status === "active" ? "success" : "secondary"} className="text-[10px]">
                        {cert.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No SSL certificates cover this domain</p>
              )}
            </div>

            {/* Quick Actions */}
            {canEdit && domain.usage.sslCertificates.length === 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Quick Actions</h3>
                  <Button size="sm" variant="outline" onClick={handleIssueCert} disabled={isIssuingCert}>
                    <Shield className="h-3.5 w-3.5" />
                    {isIssuingCert ? "Issuing..." : "Issue Let's Encrypt Cert"}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
