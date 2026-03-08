import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/services/api";
import { useCAStore } from "@/stores/ca";
import type { CAType, KeyAlgorithm, SignatureAlgorithm } from "@/types";

interface CACreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string;
}

export function CACreateDialog({ open, onOpenChange, parentId }: CACreateDialogProps) {
  const { fetchCAs } = useCAStore();

  const [name, setName] = useState("");
  const [commonName, setCommonName] = useState("");
  const [organization, setOrganization] = useState("");
  const [country, setCountry] = useState("");
  const [type, setType] = useState<CAType>(parentId ? "intermediate" : "root");
  const [keyAlgorithm, setKeyAlgorithm] = useState<KeyAlgorithm>("EC-P256");
  const [signatureAlgorithm, setSignatureAlgorithm] = useState<SignatureAlgorithm>("ECDSAWithSHA256");
  const [validityYears, setValidityYears] = useState(10);
  const [maxPathLength, setMaxPathLength] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !commonName.trim()) {
      toast.error("Name and Common Name are required");
      return;
    }

    setIsSaving(true);
    try {
      await api.createCA({
        name,
        type,
        parentId,
        subject: {
          commonName,
          organization: organization || undefined,
          country: country || undefined,
        },
        keyAlgorithm,
        signatureAlgorithm,
        validityYears,
        maxPathLength,
      });
      toast.success(`${type === "root" ? "Root" : "Intermediate"} CA created`);
      onOpenChange(false);
      await fetchCAs();

      // Reset form
      setName("");
      setCommonName("");
      setOrganization("");
      setCountry("");
      setValidityYears(10);
      setMaxPathLength(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create CA");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Create {parentId ? "Intermediate" : "Certificate"} Authority
          </DialogTitle>
          <DialogDescription>
            {parentId
              ? "Create a new intermediate CA signed by the parent CA"
              : "Create a new root or intermediate Certificate Authority"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!parentId && (
            <div className="space-y-2">
              <label className="text-sm font-medium">CA Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CAType)}
                className="flex h-9 w-full border border-input bg-transparent px-3 text-sm"
              >
                <option value="root">Root CA</option>
                <option value="intermediate">Intermediate CA</option>
              </select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My Organization Root CA"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Common Name (CN)</label>
              <Input
                value={commonName}
                onChange={(e) => setCommonName(e.target.value)}
                placeholder="e.g., My Organization Root CA"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization (O)</label>
              <Input
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="e.g., My Organization"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Country (C)</label>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g., US"
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Validity (years)</label>
              <Input
                type="number"
                value={validityYears}
                onChange={(e) => setValidityYears(parseInt(e.target.value) || 10)}
                min={1}
                max={30}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Path Length</label>
              <Input
                type="number"
                value={maxPathLength}
                onChange={(e) => setMaxPathLength(parseInt(e.target.value) || 0)}
                min={0}
                max={10}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Key Algorithm</label>
              <select
                value={keyAlgorithm}
                onChange={(e) => setKeyAlgorithm(e.target.value as KeyAlgorithm)}
                className="flex h-9 w-full border border-input bg-transparent px-3 text-sm"
              >
                <option value="RSA-2048">RSA-2048</option>
                <option value="RSA-4096">RSA-4096</option>
                <option value="EC-P256">EC-P256</option>
                <option value="EC-P384">EC-P384</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Signature Algorithm</label>
              <select
                value={signatureAlgorithm}
                onChange={(e) => setSignatureAlgorithm(e.target.value as SignatureAlgorithm)}
                className="flex h-9 w-full border border-input bg-transparent px-3 text-sm"
              >
                <option value="SHA256WithRSA">SHA256WithRSA</option>
                <option value="SHA384WithRSA">SHA384WithRSA</option>
                <option value="SHA512WithRSA">SHA512WithRSA</option>
                <option value="ECDSAWithSHA256">ECDSAWithSHA256</option>
                <option value="ECDSAWithSHA384">ECDSAWithSHA384</option>
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSaving}>
            {isSaving ? "Creating..." : "Create CA"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
