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
import type { KeyAlgorithm } from "@/types";

interface CACreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string;
}

export function CACreateDialog({ open, onOpenChange, parentId }: CACreateDialogProps) {
  const { fetchCAs } = useCAStore();

  const [commonName, setCommonName] = useState("");
  const [keyAlgorithm, setKeyAlgorithm] = useState<KeyAlgorithm>("ecdsa-p256");
  const [validityYears, setValidityYears] = useState(10);
  const [pathLengthConstraint, setPathLengthConstraint] = useState<number | undefined>(undefined);
  const [maxValidityDays, setMaxValidityDays] = useState(365);
  const [isSaving, setIsSaving] = useState(false);

  const isIntermediate = !!parentId;

  const handleCreate = async () => {
    if (!commonName.trim()) {
      toast.error("Common Name is required");
      return;
    }

    setIsSaving(true);
    try {
      const data = {
        commonName,
        keyAlgorithm,
        validityYears,
        pathLengthConstraint,
        maxValidityDays,
      };

      if (isIntermediate) {
        await api.createIntermediateCA(parentId!, data);
      } else {
        await api.createRootCA(data);
      }

      toast.success(`${isIntermediate ? "Intermediate" : "Root"} CA created successfully`);
      onOpenChange(false);
      await fetchCAs();

      // Reset form
      setCommonName("");
      setValidityYears(10);
      setPathLengthConstraint(undefined);
      setMaxValidityDays(365);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create CA");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Create {isIntermediate ? "Intermediate" : "Root"} CA
          </DialogTitle>
          <DialogDescription>
            {isIntermediate
              ? "Create a new intermediate CA signed by the parent CA."
              : "Create a new self-signed Root Certificate Authority."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Common Name (CN)</label>
            <Input
              value={commonName}
              onChange={(e) => setCommonName(e.target.value)}
              placeholder="e.g., My Organization Root CA"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Key Algorithm</label>
              <select
                value={keyAlgorithm}
                onChange={(e) => setKeyAlgorithm(e.target.value as KeyAlgorithm)}
                className="h-9 w-full text-sm"
              >
                <option value="ecdsa-p256">ECDSA P-256</option>
                <option value="ecdsa-p384">ECDSA P-384</option>
                <option value="rsa-2048">RSA 2048</option>
                <option value="rsa-4096">RSA 4096</option>
              </select>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Path Length Constraint</label>
              <Input
                type="number"
                value={pathLengthConstraint ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setPathLengthConstraint(val === "" ? undefined : parseInt(val));
                }}
                placeholder="Optional"
                min={0}
                max={10}
              />
              <p className="text-xs text-muted-foreground">
                Max depth of intermediate CAs below this CA
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Cert Validity (days)</label>
              <Input
                type="number"
                value={maxValidityDays}
                onChange={(e) => setMaxValidityDays(parseInt(e.target.value) || 365)}
                min={1}
                max={3650}
              />
              <p className="text-xs text-muted-foreground">
                Maximum validity for issued certificates
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSaving || !commonName.trim()}>
            {isSaving ? "Creating..." : "Create CA"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
