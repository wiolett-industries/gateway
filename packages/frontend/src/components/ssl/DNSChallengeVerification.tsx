import { CheckCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DNSChallenge } from "@/types";

interface DNSChallengeVerificationProps {
  challenges: DNSChallenge[];
  onVerify: () => void;
  isVerifying: boolean;
  title?: string;
  description?: string;
  verifyLabel?: string;
}

export function DNSChallengeVerification({
  challenges,
  onVerify,
  isVerifying,
  title = "DNS Challenge Records",
  description = "Add the following DNS TXT records to verify domain ownership, then click Verify.",
  verifyLabel = "Verify DNS",
}: DNSChallengeVerificationProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-5 w-5 text-amber-500" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="border border-border divide-y divide-border">
        {challenges.map((challenge, i) => (
          <div key={`${challenge.domain}-${i}`} className="p-3 space-y-1">
            <p className="text-xs text-muted-foreground">
              Domain: <span className="font-medium text-foreground">{challenge.domain}</span>
            </p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Record Name:</p>
              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 break-all min-w-0">
                {challenge.recordName}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  navigator.clipboard.writeText(challenge.recordName);
                  toast.success("Copied");
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Record Value:</p>
              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 break-all min-w-0">
                {challenge.recordValue}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  navigator.clipboard.writeText(challenge.recordValue);
                  toast.success("Copied");
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button onClick={onVerify} disabled={isVerifying}>
        {isVerifying ? "Verifying..." : verifyLabel}
      </Button>
    </div>
  );
}
