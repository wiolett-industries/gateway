import { FileText, Minus, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { CertificateType, CustomExtension, CertificatePolicy, KeyAlgorithm, Template } from "@/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY_USAGE_OPTIONS = [
  { value: "digitalSignature", label: "Digital Signature", desc: "The certificate can be used to verify digital signatures. Required for TLS and most use cases." },
  { value: "keyEncipherment", label: "Key Encipherment", desc: "The certificate can be used to encrypt symmetric keys (e.g., during TLS handshake with RSA key exchange)." },
  { value: "dataEncipherment", label: "Data Encipherment", desc: "The certificate can be used to encrypt data directly. Rarely needed." },
  { value: "keyAgreement", label: "Key Agreement", desc: "The certificate can be used in key agreement protocols (e.g., ECDH)." },
  { value: "nonRepudiation", label: "Non-Repudiation", desc: "The signer cannot deny having signed. Used for legal/compliance scenarios." },
];

const EXT_KEY_USAGE_OPTIONS = [
  { value: "serverAuth", label: "TLS Server Authentication", desc: "Allows the certificate to be used as an HTTPS/TLS server certificate." },
  { value: "clientAuth", label: "TLS Client Authentication", desc: "Allows the certificate to be used for mutual TLS (mTLS) client authentication." },
  { value: "codeSigning", label: "Code Signing", desc: "Allows the certificate to sign executables, libraries, and software packages." },
  { value: "emailProtection", label: "Email Protection (S/MIME)", desc: "Allows the certificate to sign and encrypt emails." },
  { value: "timeStamping", label: "Time Stamping", desc: "Allows the certificate to create trusted timestamps for documents." },
  { value: "ocspSigning", label: "OCSP Signing", desc: "Allows the certificate to sign OCSP responses for certificate revocation checks." },
];

const SAN_TYPE_OPTIONS = [
  { value: "dns", label: "DNS Names", desc: "Domain names like example.com or *.example.com" },
  { value: "ip", label: "IP Addresses", desc: "IPv4 or IPv6 addresses" },
  { value: "email", label: "Email Addresses", desc: "Email addresses for S/MIME certificates" },
  { value: "uri", label: "URIs", desc: "Full URIs like https://example.com/path" },
];

const WIZARD_STEPS = [
  { id: "general", title: "General", subtitle: "Name, type, and basic settings" },
  { id: "keyUsage", title: "Key Usage", subtitle: "What the certificate key can do" },
  { id: "extKeyUsage", title: "Purpose", subtitle: "What the certificate is used for" },
  { id: "san", title: "SANs", subtitle: "Subject Alternative Name rules" },
  { id: "subject", title: "Subject DN", subtitle: "Organization identity fields" },
  { id: "distribution", title: "Endpoints", subtitle: "CRL and OCSP URLs" },
  { id: "policies", title: "Policies", subtitle: "Certificate policy OIDs" },
  { id: "extensions", title: "Custom", subtitle: "Raw X.509 extensions" },
];

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function Templates() {
  const { hasRole } = useAuthStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [step, setStep] = useState(0);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [certType, setCertType] = useState<CertificateType>("tls-server");
  const [keyAlgorithm, setKeyAlgorithm] = useState<KeyAlgorithm>("ecdsa-p256");
  const [validityDays, setValidityDays] = useState(365);
  const [keyUsage, setKeyUsage] = useState<string[]>([]);
  const [extKeyUsage, setExtKeyUsage] = useState<string[]>([]);
  const [customEkuOid, setCustomEkuOid] = useState("");
  const [requireSans, setRequireSans] = useState(true);
  const [sanTypes, setSanTypes] = useState<string[]>(["dns", "ip"]);
  const [dnO, setDnO] = useState("");
  const [dnOu, setDnOu] = useState("");
  const [dnL, setDnL] = useState("");
  const [dnSt, setDnSt] = useState("");
  const [dnC, setDnC] = useState("");
  const [crlDistributionPoints, setCrlDistributionPoints] = useState<string[]>([]);
  const [ocspUrl, setOcspUrl] = useState("");
  const [caIssuersUrl, setCaIssuersUrl] = useState("");
  const [certificatePolicies, setCertificatePolicies] = useState<CertificatePolicy[]>([]);
  const [customExtensions, setCustomExtensions] = useState<CustomExtension[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const loadTemplates = async () => {
    try {
      const data = await api.listTemplates();
      setTemplates(data || []);
    } catch {
      toast.error("Failed to load templates");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadTemplates(); }, []);

  const resetForm = () => {
    setName(""); setDescription("");
    setCertType("tls-server"); setKeyAlgorithm("ecdsa-p256"); setValidityDays(365);
    setKeyUsage([]); setExtKeyUsage([]); setCustomEkuOid("");
    setRequireSans(true); setSanTypes(["dns", "ip"]);
    setDnO(""); setDnOu(""); setDnL(""); setDnSt(""); setDnC("");
    setCrlDistributionPoints([]); setOcspUrl(""); setCaIssuersUrl("");
    setCertificatePolicies([]); setCustomExtensions([]);
    setStep(0);
  };

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setName(t.name); setDescription(t.description || "");
    setCertType(t.certType); setKeyAlgorithm(t.keyAlgorithm); setValidityDays(t.validityDays);
    setKeyUsage(t.keyUsage || []); setExtKeyUsage(t.extKeyUsage || []);
    setRequireSans(t.requireSans); setSanTypes(t.sanTypes || []);
    setDnO(t.subjectDnFields?.o || ""); setDnOu(t.subjectDnFields?.ou || "");
    setDnL(t.subjectDnFields?.l || ""); setDnSt(t.subjectDnFields?.st || "");
    setDnC(t.subjectDnFields?.c || "");
    setCrlDistributionPoints(t.crlDistributionPoints || []);
    setOcspUrl(t.authorityInfoAccess?.ocspUrl || "");
    setCaIssuersUrl(t.authorityInfoAccess?.caIssuersUrl || "");
    setCertificatePolicies(t.certificatePolicies || []);
    setCustomExtensions(t.customExtensions || []);
    setStep(0);
    setDialogOpen(true);
  };

  const buildPayload = () => ({
    name, description: description || undefined,
    certType, keyAlgorithm, validityDays,
    keyUsage, extKeyUsage, requireSans, sanTypes,
    subjectDnFields: {
      ...(dnO ? { o: dnO } : {}), ...(dnOu ? { ou: dnOu } : {}),
      ...(dnL ? { l: dnL } : {}), ...(dnSt ? { st: dnSt } : {}),
      ...(dnC ? { c: dnC } : {}),
    },
    crlDistributionPoints: crlDistributionPoints.filter((u) => u.trim()),
    authorityInfoAccess: {
      ...(ocspUrl ? { ocspUrl } : {}),
      ...(caIssuersUrl ? { caIssuersUrl } : {}),
    },
    certificatePolicies: certificatePolicies.filter((p) => p.oid.trim()),
    customExtensions: customExtensions.filter((e) => e.oid.trim() && e.value.trim()),
  });

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setIsSaving(true);
    try {
      const payload = buildPayload();
      if (editing) {
        await api.updateTemplate(editing.id, payload);
        toast.success("Template updated");
      } else {
        await api.createTemplate(payload);
        toast.success("Template created");
      }
      setDialogOpen(false);
      loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (template: Template) => {
    const ok = await confirm({ title: "Delete Template", description: `Delete "${template.name}"? This cannot be undone.`, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api.deleteTemplate(template.id);
      toast.success("Template deleted");
      loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete template");
    }
  };

  const isLastStep = step === WIZARD_STEPS.length - 1;
  const canProceed = step === 0 ? name.trim() !== "" && validityDays >= 1 && validityDays <= 3650 : true;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-sm text-muted-foreground">Certificate issuance templates</p>
        </div>
        {hasRole("admin", "operator") && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create Template
          </Button>
        )}
      </div>

      {/* Template grid */}
      {templates.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <div key={template.id} className="border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">{template.name}</h3>
                </div>
                {hasRole("admin", "operator") && !template.isBuiltin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(template)}>
                        <Pencil className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDelete(template)} className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {template.description || "No description"}
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-xs capitalize">{template.certType}</Badge>
                <Badge variant="secondary" className="text-xs">{template.keyAlgorithm}</Badge>
                <Badge variant="secondary" className="text-xs">{template.validityDays}d</Badge>
                {template.isBuiltin && <Badge className="text-xs">Built-in</Badge>}
                {(template.keyUsage?.length ?? 0) > 0 && <Badge variant="secondary" className="text-xs">{template.keyUsage.length} KU</Badge>}
                {(template.extKeyUsage?.length ?? 0) > 0 && <Badge variant="secondary" className="text-xs">{template.extKeyUsage.length} EKU</Badge>}
                {(template.crlDistributionPoints?.length ?? 0) > 0 && <Badge variant="secondary" className="text-xs">CRL</Badge>}
                {(template.customExtensions?.length ?? 0) > 0 && <Badge variant="secondary" className="text-xs">{template.customExtensions.length} ext</Badge>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <p className="text-muted-foreground">No templates yet</p>
        </div>
      )}

      {/* Wizard Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "Create Template"}</DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex gap-1 px-1">
            {WIZARD_STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`flex-1 h-1 transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <div className="mb-2">
            <p className="text-sm font-medium">{WIZARD_STEPS[step].title}</p>
            <p className="text-xs text-muted-foreground">{WIZARD_STEPS[step].subtitle}</p>
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-4 px-1 -mx-1 pb-1">
            {step === 0 && <StepGeneral
              name={name} setName={setName} description={description} setDescription={setDescription}
              certType={certType} setCertType={setCertType} keyAlgorithm={keyAlgorithm} setKeyAlgorithm={setKeyAlgorithm}
              validityDays={validityDays} setValidityDays={setValidityDays}
            />}
            {step === 1 && <StepKeyUsage keyUsage={keyUsage} setKeyUsage={setKeyUsage} />}
            {step === 2 && <StepExtKeyUsage
              extKeyUsage={extKeyUsage} setExtKeyUsage={setExtKeyUsage}
              customEkuOid={customEkuOid} setCustomEkuOid={setCustomEkuOid}
            />}
            {step === 3 && <StepSAN requireSans={requireSans} setRequireSans={setRequireSans} sanTypes={sanTypes} setSanTypes={setSanTypes} />}
            {step === 4 && <StepSubjectDN dnO={dnO} setDnO={setDnO} dnOu={dnOu} setDnOu={setDnOu} dnL={dnL} setDnL={setDnL} dnSt={dnSt} setDnSt={setDnSt} dnC={dnC} setDnC={setDnC} />}
            {step === 5 && <StepDistribution
              crlDistributionPoints={crlDistributionPoints} setCrlDistributionPoints={setCrlDistributionPoints}
              ocspUrl={ocspUrl} setOcspUrl={setOcspUrl} caIssuersUrl={caIssuersUrl} setCaIssuersUrl={setCaIssuersUrl}
            />}
            {step === 6 && <StepPolicies certificatePolicies={certificatePolicies} setCertificatePolicies={setCertificatePolicies} />}
            {step === 7 && <StepCustomExtensions customExtensions={customExtensions} setCustomExtensions={setCustomExtensions} />}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div>
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              {isLastStep ? (
                <Button onClick={handleSave} disabled={isSaving || !canProceed}>
                  {isSaving ? "Saving..." : editing ? "Update" : "Create"}
                </Button>
              ) : (
                <Button onClick={() => setStep(step + 1)} disabled={!canProceed}>
                  Next
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </PageTransition>
  );
}

// ---------------------------------------------------------------------------
// Wizard Steps
// ---------------------------------------------------------------------------

function StepGeneral({ name, setName, description, setDescription, certType, setCertType, keyAlgorithm, setKeyAlgorithm, validityDays, setValidityDays }: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  certType: CertificateType; setCertType: (v: CertificateType) => void;
  keyAlgorithm: KeyAlgorithm; setKeyAlgorithm: (v: KeyAlgorithm) => void;
  validityDays: number; setValidityDays: (v: number) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Give your template a name and configure the basic certificate parameters. These settings determine the type of certificate and its cryptographic strength.
      </p>
      <div className="space-y-2">
        <label className="text-sm font-medium">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Mutual TLS Server+Client" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this template is for" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Certificate Type</label>
          <Select value={certType} onValueChange={(v) => setCertType(v as CertificateType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tls-server">TLS Server</SelectItem>
              <SelectItem value="tls-client">TLS Client</SelectItem>
              <SelectItem value="code-signing">Code Signing</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Key Algorithm</label>
          <Select value={keyAlgorithm} onValueChange={(v) => setKeyAlgorithm(v as KeyAlgorithm)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rsa-2048">RSA-2048</SelectItem>
              <SelectItem value="rsa-4096">RSA-4096</SelectItem>
              <SelectItem value="ecdsa-p256">ECDSA-P256</SelectItem>
              <SelectItem value="ecdsa-p384">ECDSA-P384</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Validity (days)</label>
          <NumericInput value={validityDays} onChange={setValidityDays} min={1} max={3650} />
        </div>
      </div>
    </div>
  );
}

function StepKeyUsage({ keyUsage, setKeyUsage }: { keyUsage: string[]; setKeyUsage: (v: string[]) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Key Usage defines what cryptographic operations the certificate's key is allowed to perform.
        If you're unsure, select <strong>Digital Signature</strong> (used by almost everything) and <strong>Key Encipherment</strong> (needed for RSA-based TLS).
      </p>
      <div className="space-y-2">
        {KEY_USAGE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-3 p-3 border border-border hover:bg-accent/50 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={keyUsage.includes(opt.value)}
              onChange={() => setKeyUsage(toggleInArray(keyUsage, opt.value))}
              className="h-4 w-4 mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>
      {keyUsage.length === 0 && (
        <p className="text-xs text-muted-foreground">No key usage selected — the certificate type default will be used.</p>
      )}
    </div>
  );
}

function StepExtKeyUsage({ extKeyUsage, setExtKeyUsage, customEkuOid, setCustomEkuOid }: {
  extKeyUsage: string[]; setExtKeyUsage: (v: string[]) => void;
  customEkuOid: string; setCustomEkuOid: (v: string) => void;
}) {
  const customOids = extKeyUsage.filter((e) => !EXT_KEY_USAGE_OPTIONS.some((o) => o.value === e));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Extended Key Usage specifies the <strong>purpose</strong> of the certificate — what applications will accept it for.
        For example, a web server certificate needs "TLS Server Authentication". You can select multiple purposes (e.g., both server and client auth for mutual TLS).
      </p>
      <div className="space-y-2">
        {EXT_KEY_USAGE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-3 p-3 border border-border hover:bg-accent/50 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={extKeyUsage.includes(opt.value)}
              onChange={() => setExtKeyUsage(toggleInArray(extKeyUsage, opt.value))}
              className="h-4 w-4 mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {customOids.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Custom OIDs</p>
          {customOids.map((oid) => (
            <div key={oid} className="flex items-center gap-2">
              <span className="text-xs font-mono flex-1">{oid}</span>
              <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => setExtKeyUsage(extKeyUsage.filter((e) => e !== oid))}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Need a purpose not listed above? Add it by OID.</p>
        <div className="flex items-center gap-2">
          <Input
            value={customEkuOid} onChange={(e) => setCustomEkuOid(e.target.value)}
            placeholder="e.g., 1.3.6.1.5.5.7.3.8"
            className="flex-1 font-mono text-xs"
          />
          <Button
            variant="outline" size="sm"
            disabled={!customEkuOid.trim() || !/^\d+(\.\d+)+$/.test(customEkuOid)}
            onClick={() => { setExtKeyUsage([...extKeyUsage, customEkuOid.trim()]); setCustomEkuOid(""); }}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      {extKeyUsage.length === 0 && (
        <p className="text-xs text-muted-foreground">No purpose selected — the certificate type default will be used.</p>
      )}
    </div>
  );
}

function StepSAN({ requireSans, setRequireSans, sanTypes, setSanTypes }: {
  requireSans: boolean; setRequireSans: (v: boolean) => void;
  sanTypes: string[]; setSanTypes: (v: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Subject Alternative Names (SANs) are the identities the certificate protects — domain names, IPs, or email addresses.
        Modern browsers <strong>require</strong> SANs for TLS certificates and ignore the Common Name field.
      </p>
      <div className="flex items-center gap-3 p-3 border border-border">
        <Switch checked={requireSans} onChange={setRequireSans} />
        <div>
          <p className="text-sm font-medium">Require SANs</p>
          <p className="text-xs text-muted-foreground">When enabled, certificates using this template must include at least one SAN.</p>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Allowed SAN types</p>
        <div className="space-y-2">
          {SAN_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-3 p-3 border border-border hover:bg-accent/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={sanTypes.includes(opt.value)}
                onChange={() => setSanTypes(toggleInArray(sanTypes, opt.value))}
                className="h-4 w-4 mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepSubjectDN({ dnO, setDnO, dnOu, setDnOu, dnL, setDnL, dnSt, setDnSt, dnC, setDnC }: {
  dnO: string; setDnO: (v: string) => void;
  dnOu: string; setDnOu: (v: string) => void;
  dnL: string; setDnL: (v: string) => void;
  dnSt: string; setDnSt: (v: string) => void;
  dnC: string; setDnC: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The Subject Distinguished Name identifies who the certificate belongs to. The Common Name (CN) is always set per-certificate.
        These fields provide <strong>default values</strong> — they can be overridden when issuing individual certificates.
      </p>
      <p className="text-xs text-muted-foreground">All fields are optional. Leave empty if not needed.</p>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">Organization (O)</label>
          <Input value={dnO} onChange={(e) => setDnO(e.target.value)} placeholder="e.g., Acme Corp" />
          <p className="text-xs text-muted-foreground">The legal name of your organization.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Organizational Unit (OU)</label>
          <Input value={dnOu} onChange={(e) => setDnOu(e.target.value)} placeholder="e.g., Engineering" />
          <p className="text-xs text-muted-foreground">Department or division within the organization.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Locality (L)</label>
            <Input value={dnL} onChange={(e) => setDnL(e.target.value)} placeholder="City" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">State (ST)</label>
            <Input value={dnSt} onChange={(e) => setDnSt(e.target.value)} placeholder="State/Province" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Country (C)</label>
            <Input value={dnC} onChange={(e) => setDnC(e.target.value)} placeholder="US" maxLength={2} />
            <p className="text-xs text-muted-foreground">2-letter code</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepDistribution({ crlDistributionPoints, setCrlDistributionPoints, ocspUrl, setOcspUrl, caIssuersUrl, setCaIssuersUrl }: {
  crlDistributionPoints: string[]; setCrlDistributionPoints: (v: string[]) => void;
  ocspUrl: string; setOcspUrl: (v: string) => void;
  caIssuersUrl: string; setCaIssuersUrl: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Distribution endpoints tell clients where to check if a certificate has been revoked and where to download the issuing CA certificate.
        These are embedded directly into the certificate. <strong>If your CA already has these configured, you can skip this step</strong> — the CA's URLs will be used automatically.
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium">CRL Distribution Points</label>
        <p className="text-xs text-muted-foreground">URLs where the Certificate Revocation List can be downloaded. Clients check this to verify the certificate hasn't been revoked.</p>
        {crlDistributionPoints.map((url, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={url}
              onChange={(e) => { const next = [...crlDistributionPoints]; next[i] = e.target.value; setCrlDistributionPoints(next); }}
              placeholder="http://crl.example.com/ca.crl" className="flex-1 font-mono text-xs"
            />
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setCrlDistributionPoints(crlDistributionPoints.filter((_, j) => j !== i))}>
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setCrlDistributionPoints([...crlDistributionPoints, ""])}>
          <Plus className="h-4 w-4" /> Add CRL URL
        </Button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">OCSP Responder URL</label>
        <p className="text-xs text-muted-foreground">Online Certificate Status Protocol — a real-time alternative to CRL for revocation checking.</p>
        <Input value={ocspUrl} onChange={(e) => setOcspUrl(e.target.value)} placeholder="http://ocsp.example.com" className="font-mono text-xs" />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">CA Issuers URL</label>
        <p className="text-xs text-muted-foreground">Where clients can download the issuing CA certificate to build the trust chain.</p>
        <Input value={caIssuersUrl} onChange={(e) => setCaIssuersUrl(e.target.value)} placeholder="http://ca.example.com/cert.pem" className="font-mono text-xs" />
      </div>
    </div>
  );
}

function StepPolicies({ certificatePolicies, setCertificatePolicies }: {
  certificatePolicies: CertificatePolicy[]; setCertificatePolicies: (v: CertificatePolicy[]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Certificate Policies define the rules and practices under which the certificate was issued.
        These are typically required for publicly-trusted certificates or enterprise PKI compliance.
        <strong> Most private/internal PKIs don't need this.</strong>
      </p>
      <div className="space-y-2">
        {certificatePolicies.map((pol, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <Input
                value={pol.oid}
                onChange={(e) => { const next = [...certificatePolicies]; next[i] = { ...next[i], oid: e.target.value }; setCertificatePolicies(next); }}
                placeholder="Policy OID (e.g., 2.23.140.1.2.1)" className="font-mono text-xs"
              />
              <Input
                value={pol.qualifier || ""}
                onChange={(e) => { const next = [...certificatePolicies]; next[i] = { ...next[i], qualifier: e.target.value }; setCertificatePolicies(next); }}
                placeholder="CPS URI (optional, e.g., https://example.com/cps)" className="font-mono text-xs"
              />
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setCertificatePolicies(certificatePolicies.filter((_, j) => j !== i))}>
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setCertificatePolicies([...certificatePolicies, { oid: "", qualifier: "" }])}>
          <Plus className="h-4 w-4" /> Add Policy
        </Button>
      </div>
    </div>
  );
}

function StepCustomExtensions({ customExtensions, setCustomExtensions }: {
  customExtensions: CustomExtension[]; setCustomExtensions: (v: CustomExtension[]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add arbitrary X.509 extensions by OID. This is an advanced feature for niche requirements
        (e.g., proprietary extensions, name constraints, or industry-specific OIDs).
        <strong> Most users don't need this.</strong>
      </p>
      <p className="text-xs text-muted-foreground">
        The value must be a <strong>hex-encoded DER</strong> byte string. You'll need to use an ASN.1 encoder to produce this.
        "Critical" means the extension <strong>must</strong> be understood by the client — if it doesn't recognize the OID, it will reject the certificate.
      </p>
      <div className="space-y-3">
        {customExtensions.map((ext, i) => (
          <div key={i} className="border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={ext.oid}
                onChange={(e) => { const next = [...customExtensions]; next[i] = { ...next[i], oid: e.target.value }; setCustomExtensions(next); }}
                placeholder="OID (e.g., 1.2.3.4.5.6.7)" className="flex-1 font-mono text-xs"
              />
              <label className="flex items-center gap-1.5 text-xs shrink-0 cursor-pointer">
                <input
                  type="checkbox" checked={ext.critical}
                  onChange={(e) => { const next = [...customExtensions]; next[i] = { ...next[i], critical: e.target.checked }; setCustomExtensions(next); }}
                  className="h-3.5 w-3.5"
                />
                Critical
              </label>
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setCustomExtensions(customExtensions.filter((_, j) => j !== i))}>
                <Minus className="h-4 w-4" />
              </Button>
            </div>
            <Input
              value={ext.value}
              onChange={(e) => { const next = [...customExtensions]; next[i] = { ...next[i], value: e.target.value }; setCustomExtensions(next); }}
              placeholder="Hex-encoded DER value" className="font-mono text-xs"
            />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setCustomExtensions([...customExtensions, { oid: "", critical: false, value: "" }])}>
          <Plus className="h-4 w-4" /> Add Extension
        </Button>
      </div>
    </div>
  );
}
