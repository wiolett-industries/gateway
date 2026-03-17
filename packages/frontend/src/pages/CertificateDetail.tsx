import {
  Award,
  Copy,
  Download,
  MoreVertical,
  ShieldOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageTransition } from "@/components/common/PageTransition";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { Certificate } from "@/types";
import { formatDate, formatSerialNumber, daysUntil } from "@/lib/utils";

export function CertificateDetail() {
  const { id } = useParams<{ id: string }>();
  const { hasRole } = useAuthStore();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await api.getCertificate(id);
        setCert(data);
      } catch (err) {
        toast.error("Failed to load certificate");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id]);

  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("unspecified");
  const [isRevoking, setIsRevoking] = useState(false);

  const handleRevoke = async () => {
    if (!cert) return;
    setIsRevoking(true);
    try {
      await api.revokeCertificate(cert.id, revokeReason);
      const updated = await api.getCertificate(cert.id);
      setCert(updated);
      toast.success("Certificate revoked");
      setRevokeDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setIsRevoking(false);
    }
  };

  const handleDownload = async (format: "pem" | "der" | "pkcs12") => {
    if (!cert) return;
    try {
      const blob = await api.exportCertificate(cert.id, format);
      const ext = format === "pem" ? "pem" : format === "der" ? "der" : "p12";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cert.commonName}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download certificate");
    }
  };

  if (isLoading) {
    return (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
    );
  }

  if (!cert) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Certificate not found</p>
      </div>
    );
  }

  const expiryDays = daysUntil(cert.notAfter);

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Award className="h-6 w-6" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{cert.commonName}</h1>
              <StatusBadge status={cert.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {cert.type} certificate &middot; Issuer: {cert.issuerDn || cert.caId}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownload("pem")}>
                <Download className="h-4 w-4" />
                Download PEM
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload("der")}>
                <Download className="h-4 w-4" />
                Download DER
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload("pkcs12")}>
                <Download className="h-4 w-4" />
                Download PKCS#12
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                navigator.clipboard.writeText(cert.serialNumber);
                toast.success("Serial number copied");
              }}>
                <Copy className="h-4 w-4" />
                Copy Serial Number
              </DropdownMenuItem>
              {cert.certificatePem && (
                <DropdownMenuItem onClick={() => {
                  navigator.clipboard.writeText(cert.certificatePem!);
                  toast.success("PEM copied to clipboard");
                }}>
                  <Copy className="h-4 w-4" />
                  Copy PEM
                </DropdownMenuItem>
              )}
              {hasRole("admin", "operator") && cert.status === "active" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setRevokeDialogOpen(true)} className="text-destructive">
                    <ShieldOff className="h-4 w-4" />
                    Revoke Certificate
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Details */}
        <div className="border border-border bg-card lg:col-span-2">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Certificate Details</h2>
          </div>
          <div className="p-4 space-y-3">
            <InfoRow label="Common Name" value={cert.commonName} />
            {cert.subjectDn && <InfoRow label="Subject DN" value={cert.subjectDn} />}
            {cert.issuerDn && <InfoRow label="Issuer DN" value={cert.issuerDn} />}
            <InfoRow label="Serial Number" value={formatSerialNumber(cert.serialNumber)} />
            <InfoRow label="Key Algorithm" value={cert.keyAlgorithm} />
            <InfoRow label="Valid From" value={formatDate(cert.notBefore)} />
            <InfoRow label="Valid Until" value={formatDate(cert.notAfter)} />
            {cert.templateId && <InfoRow label="Template ID" value={cert.templateId} />}
            <InfoRow label="Issued By" value={cert.issuedById || "-"} />
            {cert.revokedAt && (
              <>
                <InfoRow label="Revoked At" value={formatDate(cert.revokedAt)} />
                <InfoRow label="Revocation Reason" value={cert.revocationReason || "unspecified"} />
              </>
            )}
          </div>
        </div>

        {/* Side info */}
        <div className="space-y-4">
          {/* SANs */}
          {(cert.sans?.length ?? 0) > 0 && (
            <div className="border border-border bg-card p-4 space-y-2">
              <h3 className="font-semibold text-sm">Subject Alternative Names</h3>
              <div className="space-y-1">
                {cert.sans.map((san, i) => (
                  <p key={i} className="text-sm font-mono text-muted-foreground">{san}</p>
                ))}
              </div>
            </div>
          )}

          {/* Key Usage */}
          {(cert.keyUsage?.length ?? 0) > 0 && (
            <div className="border border-border bg-card p-4 space-y-2">
              <h3 className="font-semibold text-sm">Key Usage</h3>
              <div className="flex flex-wrap gap-1">
                {cert.keyUsage.map((ku) => (
                  <Badge key={ku} variant="secondary" className="text-xs">{ku}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Extended Key Usage */}
          {(cert.extKeyUsage?.length ?? 0) > 0 && (
            <div className="border border-border bg-card p-4 space-y-2">
              <h3 className="font-semibold text-sm">Extended Key Usage</h3>
              <div className="flex flex-wrap gap-1">
                {cert.extKeyUsage.map((eku) => (
                  <Badge key={eku} variant="secondary" className="text-xs">{eku}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Expiry info */}
          <div className="border border-border bg-card p-4 space-y-2">
            <h3 className="font-semibold text-sm">Validity</h3>
            <p className={`text-sm font-medium ${
              expiryDays <= 0 ? "text-destructive" :
              expiryDays <= 30 ? "text-[color:var(--color-warning)]" :
              "text-[color:var(--color-success)]"
            }`}>
              {expiryDays > 0 ? `Expires in ${expiryDays} days` : "Expired"}
            </p>
          </div>
        </div>
      </div>
      {/* Revoke Dialog */}
      <Dialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke Certificate</DialogTitle>
            <DialogDescription>
              Select a reason for revocation. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason</label>
            <Select value={revokeReason} onValueChange={setRevokeReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unspecified">Unspecified</SelectItem>
                <SelectItem value="keyCompromise">Key Compromise</SelectItem>
                <SelectItem value="caCompromise">CA Compromise</SelectItem>
                <SelectItem value="affiliationChanged">Affiliation Changed</SelectItem>
                <SelectItem value="superseded">Superseded</SelectItem>
                <SelectItem value="cessationOfOperation">Cessation of Operation</SelectItem>
                <SelectItem value="certificateHold">Certificate Hold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={isRevoking}>
              {isRevoking ? "Revoking..." : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </PageTransition>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right break-all">{value}</span>
    </div>
  );
}
