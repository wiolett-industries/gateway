import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ElementType } from "react";

export type AIApprovalMode =
  | "always-ask"
  | "normal"
  | "bypass-non-destructive"
  | "bypass-everything";

export interface AIApprovalFlags {
  aiAlwaysAskApprovals: boolean;
  aiBypassCreateApprovals: boolean;
  aiBypassEditApprovals: boolean;
  aiBypassDeleteApprovals: boolean;
}

export const AI_APPROVAL_MODES: AIApprovalMode[] = [
  "always-ask",
  "normal",
  "bypass-non-destructive",
  "bypass-everything",
];

export const AI_APPROVAL_MODE_META: Record<
  AIApprovalMode,
  { label: string; menuLabel: string; description: string; icon: ElementType }
> = {
  "always-ask": {
    label: "Always ask",
    menuLabel: "Always ask",
    description: "Ask before every assistant tool action.",
    icon: Shield,
  },
  normal: {
    label: "Normal",
    menuLabel: "Normal",
    description: "Auto-approve safe read-only actions and ask before changes.",
    icon: Shield,
  },
  "bypass-non-destructive": {
    label: "Bypass non-destructive",
    menuLabel: "Bypass non-destructive",
    description: "Allow creates and edits without confirmation, but still ask before deletes.",
    icon: ShieldCheck,
  },
  "bypass-everything": {
    label: "Full access",
    menuLabel: "Bypass everything",
    description: "Allow creates, edits, and deletes without confirmation.",
    icon: ShieldAlert,
  },
};

export function flagsToAIApprovalMode(flags: AIApprovalFlags): AIApprovalMode {
  if (flags.aiAlwaysAskApprovals) return "always-ask";
  if (flags.aiBypassDeleteApprovals) return "bypass-everything";
  if (flags.aiBypassCreateApprovals || flags.aiBypassEditApprovals) return "bypass-non-destructive";
  return "normal";
}

export function aiApprovalModeToFlags(mode: AIApprovalMode): AIApprovalFlags {
  return {
    aiAlwaysAskApprovals: mode === "always-ask",
    aiBypassCreateApprovals: mode === "bypass-non-destructive" || mode === "bypass-everything",
    aiBypassEditApprovals: mode === "bypass-non-destructive" || mode === "bypass-everything",
    aiBypassDeleteApprovals: mode === "bypass-everything",
  };
}

export function formatAIApprovalModeLabel(mode: AIApprovalMode): string {
  return `AI mode: ${AI_APPROVAL_MODE_META[mode].menuLabel.toLowerCase()}`;
}

export function isAIApprovalMode(value: unknown): value is AIApprovalMode {
  return typeof value === "string" && AI_APPROVAL_MODES.includes(value as AIApprovalMode);
}
