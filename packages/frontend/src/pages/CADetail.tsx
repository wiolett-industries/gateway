import {
  AlertTriangle,
  Award,
  Copy,
  MoreVertical,
  Plus,
  Shield,
  ShieldOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { CACreateDialog } from "@/components/ca/CACreateDialog";
import { CertificateIssueDialog } from "@/components/certificates/CertificateIssueDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import type { Certificate } from "@/types";
import { formatDate, formatSerialNumber, daysUntil } from "@/lib/utils";

const statusBadge = (status: string) => {
  switch (status) {
    case "active": return <Badge className="bg-green-600 text-white">Active</Badge>;
    case "revoked": return <Badge variant="destructive">Revoked</Badge>;
    case "expired": return <Badge variant="secondary">Expired</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
};

export function CADetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const { selectedCA, selectCA, fetchCAs, cas } = useCAStore();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [createIntermediateOpen, setCreateIntermediateOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setIsLoading(true);
      try {
        await selectCA(id);
        const certs = await api.listCertificates({ caId: id, limit: 50 });
        setCertificates(certs.data || []);
      } catch { toast.error("Failed to load CA details"); }
      finally { setIsLoading(false); }
    };
    load();
  }, [id, selectCA]);

  const handleRevoke = async () => {
    if (!selectedCA) return;
    const ok = await confirm({ title: "Revoke CA", description: "This will revoke the CA and all certificates issued by it. This action cannot be undone.", confirmLabel: "Revoke CA" });
    if (!ok) return;
    try {
      await api.revokeCA(selectedCA.id, "cessationOfOperation");
      toast.success("CA revoked");
      await selectCA(selectedCA.id);
      await fetchCAs();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to revoke CA"); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }
  if (!selectedCA) {
    return <div className="flex h-full items-center justify-center"><p className="text-muted-foreground">CA not found</p></div>;
  }

  const ca = selectedCA;
  const expiryDays = daysUntil(ca.notAfter);
  const childCAs = (cas || []).filter((c) => c.parentId === ca.id);

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{ca.commonName}</h1>
            {statusBadge(ca.status)}
          </div>
          <p className="text-sm text-muted-foreground">{ca.type === "root" ? "Root CA" : "Intermediate CA"}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasRole("admin") && ca.status === "active" && (
            <Button variant="outline" onClick={() => setCreateIntermediateOpen(true)}>
              <Shield className="h-4 w-4" />Create Intermediate
            </Button>
          )}
          {hasRole("admin", "operator") && ca.status === "active" && (
            <Button onClick={() => setIssueDialogOpen(true)}>
              <Plus className="h-4 w-4" />Issue Certificate
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon"><MoreVertical className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(ca.certificatePem || ""); toast.success("PEM copied"); }}>
                <Copy className="h-4 w-4" />Copy PEM
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(ca.serialNumber); toast.success("Serial copied"); }}>
                <Copy className="h-4 w-4" />Copy Serial
              </DropdownMenuItem>
              {hasRole("admin") && ca.status === "active" && (
                <><DropdownMenuSeparator /><DropdownMenuItem onClick={handleRevoke} className="text-destructive"><ShieldOff className="h-4 w-4" />Revoke CA</DropdownMenuItem></>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Details + Certs */}
        <div className="lg:col-span-2 space-y-6">
          <div className="border border-border bg-card">
            <div className="border-b border-border p-4"><h2 className="font-semibold">Certificate Details</h2></div>
            <div className="p-4 space-y-3">
              <InfoRow label="Common Name" value={ca.commonName} />
              {ca.subjectDn && <InfoRow label="Subject DN" value={ca.subjectDn} />}
              {ca.issuerDn && <InfoRow label="Issuer DN" value={ca.issuerDn} />}
              <InfoRow label="Serial Number" value={formatSerialNumber(ca.serialNumber)} />
              <InfoRow label="Key Algorithm" value={ca.keyAlgorithm} />
              <InfoRow label="Valid From" value={formatDate(ca.notBefore)} />
              <InfoRow label="Valid Until" value={formatDate(ca.notAfter)} />
              <InfoRow label="Path Length" value={ca.pathLengthConstraint != null ? ca.pathLengthConstraint.toString() : "Unlimited"} />
              <InfoRow label="Max Cert Validity" value={`${ca.maxValidityDays} days`} />
            </div>
          </div>

          {/* Issued Certificates — same column */}
          <div className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="font-semibold">Issued Certificates</h2>
              <Badge variant="secondary">{certificates.length}</Badge>
            </div>
            {certificates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-3 text-xs font-medium text-muted-foreground">Common Name</th>
                      <th className="p-3 text-xs font-medium text-muted-foreground">Type</th>
                      <th className="p-3 text-xs font-medium text-muted-foreground">Expires</th>
                      <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {certificates.map((cert) => (
                      <tr key={cert.id} className="hover:bg-accent transition-colors cursor-pointer" onClick={() => navigate(`/certificates/${cert.id}`)}>
                        <td className="p-3 text-sm font-medium">{cert.commonName}</td>
                        <td className="p-3 text-sm text-muted-foreground">{cert.type}</td>
                        <td className="p-3 text-sm text-muted-foreground">{formatDate(cert.notAfter)}</td>
                        <td className="p-3">{statusBadge(cert.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8">
                <Award className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No certificates issued yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Summary + Child CAs */}
        <div className="space-y-4">
          <div className="border border-border bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">Summary</h3>
            <div className="space-y-2">
              <SummaryRow label="Certificates" value={ca.certCount.toString()} />
              <SummaryRow label="Expires in" value={expiryDays > 0 ? `${expiryDays} days` : "Expired"} warn={expiryDays <= 30} />
              <SummaryRow label="Type" value={ca.type} capitalize />
              <SummaryRow label="CRL Number" value={ca.crlNumber.toString()} />
            </div>
          </div>

          {expiryDays <= 30 && expiryDays > 0 && (
            <div className="flex items-start gap-2 border border-yellow-600/30 bg-yellow-600/5 p-3">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
              <p className="text-sm text-yellow-600 dark:text-yellow-400">Expires in {expiryDays} days.</p>
            </div>
          )}

          {childCAs.length > 0 && (
            <div className="border border-border bg-card">
              <div className="border-b border-border p-3"><h3 className="font-semibold text-sm">Child CAs</h3></div>
              <div className="divide-y divide-border">
                {childCAs.map((child) => (
                  <div key={child.id} onClick={() => navigate(`/cas/${child.id}`)} className="flex items-center justify-between p-3 hover:bg-accent transition-colors cursor-pointer">
                    <span className="text-sm">{child.commonName}</span>
                    {statusBadge(child.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {id && (
        <>
          <CertificateIssueDialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen} caId={id} />
          <CACreateDialog open={createIntermediateOpen} onOpenChange={setCreateIntermediateOpen} parentId={id} />
        </>
      )}
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

function SummaryRow({ label, value, warn, capitalize }: { label: string; value: string; warn?: boolean; capitalize?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${warn ? "text-yellow-600 dark:text-yellow-400" : ""} ${capitalize ? "capitalize" : ""}`}>{value}</span>
    </div>
  );
}
