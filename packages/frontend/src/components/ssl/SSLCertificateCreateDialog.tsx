import { Minus, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DomainAutocompleteInput } from "@/components/domains/DomainAutocompleteInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/services/api";
import type { ACMEChallengeType, DNSChallenge } from "@/types";
import { DNSChallengeVerification } from "./DNSChallengeVerification";

interface SSLCertificateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function SSLCertificateCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: SSLCertificateCreateDialogProps) {
  // ACME tab state
  const [acmeDomains, setAcmeDomains] = useState<string[]>([""]);
  const [challengeType, setChallengeType] = useState<ACMEChallengeType>("http-01");
  const [acmeProvider, setAcmeProvider] = useState("letsencrypt");
  const [isRequestingACME, setIsRequestingACME] = useState(false);
  const [dnsChallenges, setDnsChallenges] = useState<DNSChallenge[] | null>(null);
  const [pendingCertId, setPendingCertId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Upload tab state
  const [uploadName, setUploadName] = useState("");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [chainPem, setChainPem] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Internal CA tab state
  const [pkiCerts, setPkiCerts] = useState<{ id: string; commonName: string }[]>([]);
  const [selectedPkiCertId, setSelectedPkiCertId] = useState("");
  const [internalName, setInternalName] = useState("");
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    if (!open) return;
    const loadPkiCerts = async () => {
      try {
        const res = await api.listCertificates({
          limit: 100,
          status: "active",
          type: "tls-server",
        });
        setPkiCerts((res.data || []).map((c) => ({ id: c.id, commonName: c.commonName })));
      } catch {
        // non-critical
      }
    };
    loadPkiCerts();
  }, [open]);

  const resetForm = () => {
    setAcmeDomains([""]);
    setChallengeType("http-01");
    setAcmeProvider("letsencrypt");
    setDnsChallenges(null);
    setPendingCertId(null);
    setUploadName("");
    setCertPem("");
    setKeyPem("");
    setChainPem("");
    setSelectedPkiCertId("");
    setInternalName("");
  };

  const handleClose = (value: boolean) => {
    if (!value) resetForm();
    onOpenChange(value);
  };

  const handleRequestACME = async () => {
    const domains = acmeDomains.filter((d) => d.trim() !== "");
    if (domains.length === 0) {
      toast.error("At least one domain is required");
      return;
    }
    setIsRequestingACME(true);
    try {
      const result = await api.requestACMECert({
        domains,
        challengeType,
        provider: acmeProvider,
        autoRenew: true,
      });
      if (result.status === "pending_dns_verification" && result.challenges) {
        setDnsChallenges(result.challenges as DNSChallenge[]);
        setPendingCertId(result.certificate.id);
        toast.success("DNS challenge records created. Please add them to your DNS.");
      } else {
        toast.success("Certificate requested successfully");
        onOpenChange(false);
        onCreated();
        setTimeout(() => resetForm(), 200);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request certificate");
    } finally {
      setIsRequestingACME(false);
    }
  };

  const handleVerifyDNS = async () => {
    if (!pendingCertId) {
      toast.error("No pending certificate to verify");
      return;
    }
    setIsVerifying(true);
    try {
      await api.completeDNSVerify(pendingCertId);
      toast.success("DNS verification complete. Certificate issued.");
      onOpenChange(false);
      onCreated();
      setTimeout(() => resetForm(), 200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "DNS verification failed");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadName.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!certPem.trim()) {
      toast.error("Certificate PEM is required");
      return;
    }
    if (!keyPem.trim()) {
      toast.error("Private key PEM is required");
      return;
    }
    setIsUploading(true);
    try {
      await api.uploadCert({
        name: uploadName,
        certificatePem: certPem,
        privateKeyPem: keyPem,
        chainPem: chainPem || undefined,
      });
      toast.success("Certificate uploaded successfully");
      onOpenChange(false);
      onCreated();
      setTimeout(() => resetForm(), 200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload certificate");
    } finally {
      setIsUploading(false);
    }
  };

  const handleLinkInternal = async () => {
    if (!selectedPkiCertId) {
      toast.error("Select a PKI certificate");
      return;
    }
    setIsLinking(true);
    try {
      await api.linkInternalCert({
        internalCertId: selectedPkiCertId,
        name: internalName || undefined,
      });
      toast.success("Internal certificate linked");
      onOpenChange(false);
      onCreated();
      setTimeout(() => resetForm(), 200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to link certificate");
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add SSL Certificate</DialogTitle>
          <DialogDescription>Choose a method to add an SSL certificate.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="acme">
          <TabsList>
            <TabsTrigger value="acme">Let's Encrypt</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="internal">Internal CA</TabsTrigger>
          </TabsList>

          {/* ACME / Let's Encrypt Tab */}
          <TabsContent value="acme">
            <div className="space-y-4">
              {dnsChallenges ? (
                <DNSChallengeVerification
                  challenges={dnsChallenges}
                  onVerify={handleVerifyDNS}
                  isVerifying={isVerifying}
                />
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Domains</label>
                    <div className="space-y-2">
                      {acmeDomains.map((domain, i) => (
                        <div key={i} className="flex gap-2">
                          <DomainAutocompleteInput
                            value={domain}
                            onChange={(v) => {
                              const next = [...acmeDomains];
                              next[i] = v;
                              setAcmeDomains(next);
                            }}
                            placeholder="example.com"
                          />
                          {acmeDomains.length > 1 && (
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => setAcmeDomains(acmeDomains.filter((_, j) => j !== i))}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAcmeDomains([...acmeDomains, ""])}
                      >
                        <Plus className="h-4 w-4" />
                        Add Domain
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Challenge Type</label>
                      <Select
                        value={challengeType}
                        onValueChange={(v) => setChallengeType(v as ACMEChallengeType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="http-01">HTTP-01</SelectItem>
                          <SelectItem value="dns-01">DNS-01</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Provider</label>
                      <Select value={acmeProvider} onValueChange={setAcmeProvider}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="letsencrypt">Let's Encrypt</SelectItem>
                          <SelectItem value="letsencrypt-staging">
                            Let's Encrypt (Staging)
                          </SelectItem>
                          <SelectItem value="zerossl">ZeroSSL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {challengeType === "dns-01" && (
                    <p className="text-xs text-muted-foreground">
                      DNS-01 challenges require you to create TXT records. After requesting, you'll
                      be shown the records to add.
                    </p>
                  )}

                  <Button onClick={handleRequestACME} disabled={isRequestingACME}>
                    {isRequestingACME ? "Requesting..." : "Request Certificate"}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Upload Tab */}
          <TabsContent value="upload">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="My Certificate"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Certificate PEM</label>
                <textarea
                  className="w-full h-32 bg-background border border-input p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={certPem}
                  onChange={(e) => setCertPem(e.target.value)}
                  placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Private Key PEM</label>
                <textarea
                  className="w-full h-32 bg-background border border-input p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={keyPem}
                  onChange={(e) => setKeyPem(e.target.value)}
                  placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Chain PEM (optional)</label>
                <textarea
                  className="w-full h-24 bg-background border border-input p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={chainPem}
                  onChange={(e) => setChainPem(e.target.value)}
                  placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                />
              </div>
              <Button onClick={handleUpload} disabled={isUploading}>
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading..." : "Upload Certificate"}
              </Button>
            </div>
          </TabsContent>

          {/* Internal CA Tab */}
          <TabsContent value="internal">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Link an existing PKI certificate from your internal Certificate Authorities for use
                as an SSL certificate.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">PKI Certificate</label>
                <Select value={selectedPkiCertId} onValueChange={setSelectedPkiCertId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a certificate..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pkiCerts.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No active TLS server certificates
                      </SelectItem>
                    ) : (
                      pkiCerts.map((cert) => (
                        <SelectItem key={cert.id} value={cert.id}>
                          {cert.commonName}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Name Override (optional)</label>
                <Input
                  value={internalName}
                  onChange={(e) => setInternalName(e.target.value)}
                  placeholder="Auto-generated from certificate"
                />
              </div>
              <Button onClick={handleLinkInternal} disabled={isLinking || !selectedPkiCertId}>
                {isLinking ? "Linking..." : "Link Certificate"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
