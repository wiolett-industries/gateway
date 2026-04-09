import { Eye, EyeOff, Lock, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface SecretRow {
  /** DB id — undefined for newly added secrets */
  id?: string;
  key: string;
  value: string;
  /** true when the value has been changed from its original */
  dirty: boolean;
}

interface SecretsSectionProps {
  canManageSecrets: boolean;
  secretRows: SecretRow[];
  setSecretRows: React.Dispatch<React.SetStateAction<SecretRow[]>>;
  setDeletedSecretIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  duplicateSecretIndices: Set<number>;
  invalidKeyPattern: RegExp;
}

export function SecretsSection({
  canManageSecrets,
  secretRows,
  setSecretRows,
  setDeletedSecretIds,
  duplicateSecretIndices,
  invalidKeyPattern,
}: SecretsSectionProps) {
  const [revealedSecrets, setRevealedSecrets] = useState<Set<number>>(new Set());

  const addSecretRow = () =>
    setSecretRows((prev) => [...prev, { key: "", value: "", dirty: true }]);

  const updateSecretRow = (idx: number, field: "key" | "value", val: string) => {
    setSecretRows((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: val, dirty: true };
      return updated;
    });
  };

  const removeSecretRow = (idx: number) => {
    const row = secretRows[idx];
    if (row.id) setDeletedSecretIds((prev) => new Set(prev).add(row.id!));
    setSecretRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleReveal = (idx: number) => {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const isLastSecret = (idx: number) => idx === secretRows.length - 1;

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold">Secrets</h3>
            <p className="text-xs text-muted-foreground">
              Encrypted at rest — injected as env vars on container start
            </p>
          </div>
        </div>
        {canManageSecrets && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={addSecretRow}
            title="Add secret"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {secretRows.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr] border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div className="px-3 py-2">Key</div>
          <div className="px-3 py-2 border-l border-border">Value</div>
        </div>
      )}

      <div className="-mb-px">
        {secretRows.map((row, idx) => {
          const isNew = !row.id;
          const isMasked = row.value === "••••••••";
          const isRevealed = revealedSecrets.has(idx);
          const hasKeyError =
            duplicateSecretIndices.has(idx) ||
            (row.key.trim() && !invalidKeyPattern.test(row.key.trim()));

          return (
            <div
              key={row.id ?? `new-${idx}`}
              className="grid grid-cols-[1fr_1fr] border-b border-border last:border-b-0"
            >
              {canManageSecrets ? (
                <>
                  <Input
                    value={row.key}
                    onChange={(e) => isNew && updateSecretRow(idx, "key", e.target.value)}
                    readOnly={!isNew}
                    className={`h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
                      hasKeyError ? "bg-red-500/15 text-red-400" : ""
                    }`}
                    placeholder="SECRET_KEY"
                  />
                  <div className="flex items-center border-l border-border">
                    <Input
                      type={isNew || isRevealed ? "text" : "password"}
                      value={isMasked && !row.dirty ? "" : row.value}
                      onChange={(e) => updateSecretRow(idx, "value", e.target.value)}
                      className="h-9 text-xs font-mono border-0 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring flex-1 min-w-0"
                      placeholder={isMasked && !row.dirty ? "••••••••" : "secret value"}
                    />
                    {!isNew && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                        onClick={() => toggleReveal(idx)}
                        title={isRevealed ? "Hide" : "Show"}
                      >
                        {isRevealed ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                      onClick={() => removeSecretRow(idx)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    {isLastSecret(idx) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-none border-l border-border"
                        onClick={addSecretRow}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span className="px-3 py-2 text-xs md:text-sm font-mono truncate">
                    {row.key}
                  </span>
                  <span className="px-3 py-2 text-xs md:text-sm font-mono text-muted-foreground truncate border-l border-border">
                    ••••••••
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      {secretRows.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">
            No secrets configured.
            {canManageSecrets && (
              <>
                {" "}
                <button onClick={addSecretRow} className="text-foreground hover:underline">
                  Add one
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
