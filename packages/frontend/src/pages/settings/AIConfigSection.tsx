import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AIToolAccessModal } from "@/components/ai/AIToolAccessModal";
import { PanelShell } from "@/components/common/PanelShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/services/api";
import { useAIStore } from "@/stores/ai";

interface AIConfigState {
  enabled: boolean;
  providerUrl: string;
  endpointMode: string;
  model: string;
  maxCompletionTokens: number;
  maxTokensField: string;
  reasoningEffort: string;
  customSystemPrompt: string;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  maxToolRounds: number;
  maxContextTokens: number;
  disabledTools: string[];
  hasApiKey: boolean;
  apiKeyLast4: string;
  hasWebSearchKey: boolean;
  webSearchProvider: string;
  webSearchBaseUrl: string;
}

export function AIConfigSection() {
  const [aiConfig, setAiConfig] = useState<AIConfigState | null>(
    () => api.getCached<AIConfigState>("settings:ai-config") ?? null
  );
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiWebSearchKey, setAiWebSearchKey] = useState("");
  const [aiToolsModalOpen, setAiToolsModalOpen] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSavedConfig, setAiSavedConfig] = useState<AIConfigState | null>(
    () => api.getCached<AIConfigState>("settings:ai-config") ?? null
  );

  const aiHasChanges = (() => {
    if (!aiConfig || !aiSavedConfig) return false;
    if (aiApiKey || aiWebSearchKey) return true;
    return (
      aiConfig.enabled !== aiSavedConfig.enabled ||
      aiConfig.providerUrl !== aiSavedConfig.providerUrl ||
      aiConfig.endpointMode !== aiSavedConfig.endpointMode ||
      aiConfig.model !== aiSavedConfig.model ||
      aiConfig.maxCompletionTokens !== aiSavedConfig.maxCompletionTokens ||
      aiConfig.maxTokensField !== aiSavedConfig.maxTokensField ||
      aiConfig.reasoningEffort !== aiSavedConfig.reasoningEffort ||
      aiConfig.rateLimitMax !== aiSavedConfig.rateLimitMax ||
      aiConfig.rateLimitWindowSeconds !== aiSavedConfig.rateLimitWindowSeconds ||
      aiConfig.maxToolRounds !== aiSavedConfig.maxToolRounds ||
      aiConfig.maxContextTokens !== aiSavedConfig.maxContextTokens ||
      aiConfig.customSystemPrompt !== aiSavedConfig.customSystemPrompt ||
      aiConfig.webSearchProvider !== aiSavedConfig.webSearchProvider ||
      aiConfig.webSearchBaseUrl !== aiSavedConfig.webSearchBaseUrl ||
      JSON.stringify(aiConfig.disabledTools) !== JSON.stringify(aiSavedConfig.disabledTools)
    );
  })();

  const loadAIConfig = useCallback(async () => {
    try {
      const config = (await api.getAIConfig()) as any;
      api.setCache("settings:ai-config", config);
      setAiConfig(config);
      setAiSavedConfig(config);
    } catch {
      /* AI not configured yet */
    }
  }, []);

  const updateAIConfig = async (partial: Record<string, unknown>) => {
    setAiSaving(true);
    try {
      const updated = (await api.updateAIConfig(partial)) as any;
      setAiConfig((prev) => {
        if (!prev) return null;
        const next = { ...prev, ...updated };
        api.setCache("settings:ai-config", next);
        setAiSavedConfig(next);
        return next;
      });
      api
        .getAIStatus()
        .then((s) => useAIStore.getState().setEnabled(s.enabled))
        .catch(() => {});
      toast.success("AI settings updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update AI settings");
    } finally {
      setAiSaving(false);
    }
  };

  const saveAIConfig = async () => {
    if (!aiConfig) return;
    const updates: Record<string, unknown> = {
      enabled: aiConfig.enabled,
      providerUrl: aiConfig.providerUrl,
      endpointMode: aiConfig.endpointMode,
      model: aiConfig.model,
      maxCompletionTokens: aiConfig.maxCompletionTokens,
      maxTokensField: aiConfig.maxTokensField,
      reasoningEffort: aiConfig.reasoningEffort,
      rateLimitMax: aiConfig.rateLimitMax,
      rateLimitWindowSeconds: aiConfig.rateLimitWindowSeconds,
      maxToolRounds: aiConfig.maxToolRounds,
      maxContextTokens: aiConfig.maxContextTokens,
      customSystemPrompt: aiConfig.customSystemPrompt,
      disabledTools: aiConfig.disabledTools,
      webSearchProvider: aiConfig.webSearchProvider,
      webSearchBaseUrl: aiConfig.webSearchBaseUrl,
    };
    if (aiApiKey) updates.apiKey = aiApiKey;
    if (aiWebSearchKey) updates.webSearchApiKey = aiWebSearchKey;
    await updateAIConfig(updates);
    setAiApiKey("");
    setAiWebSearchKey("");
  };

  useEffect(() => {
    loadAIConfig();
  }, [loadAIConfig]);

  if (!aiConfig) return null;

  return (
    <>
      <PanelShell
        title="AI Assistant"
        description="Configure the AI assistant for operators and admins"
        actions={
          <Button onClick={saveAIConfig} disabled={!aiHasChanges || aiSaving}>
            <Save className="h-4 w-4" />
            Save
          </Button>
        }
        dirty={aiHasChanges}
      >
        <div className="border-b border-border">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable the AI assistant for operators and admins
              </p>
            </div>
            <Switch
              checked={aiConfig.enabled}
              disabled={aiSaving}
              onChange={(enabled) => setAiConfig({ ...aiConfig, enabled })}
            />
          </div>
        </div>
        <div
          className={`transition-opacity duration-200 ${!aiConfig.enabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          {/* Reasoning Effort */}
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <p className="text-sm font-medium">Reasoning effort</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controls thinking depth for reasoning models (o1, o3, o4-mini). Ignored by
                non-reasoning models.
              </p>
            </div>
            <Tabs
              value={aiConfig.reasoningEffort}
              onValueChange={(reasoningEffort) => setAiConfig({ ...aiConfig, reasoningEffort })}
              className="shrink-0"
            >
              <TabsList>
                {(["none", "low", "medium", "high"] as const).map((level) => (
                  <TabsTrigger key={level} value={level} className="capitalize">
                    {level === "none" ? "Default" : level}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {/* Provider */}
            <div className="border-t border-r border-border p-4 space-y-3 max-sm:border-r-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Provider
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Base URL</label>
                  <Input
                    className="mt-1 text-sm"
                    placeholder="https://api.openai.com/v1"
                    value={aiConfig.providerUrl}
                    onChange={(e) => setAiConfig({ ...aiConfig, providerUrl: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Endpoint</label>
                  <Select
                    value={aiConfig.endpointMode || "auto"}
                    onValueChange={(endpointMode) => setAiConfig({ ...aiConfig, endpointMode })}
                  >
                    <SelectTrigger className="mt-1 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="responses">Responses API</SelectItem>
                      <SelectItem value="chat_completions">Chat Completions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Model</label>
                <Input
                  className="mt-1 text-sm"
                  placeholder="gpt-4o"
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">API Key</label>
                <Input
                  className="mt-1 text-sm"
                  type="password"
                  placeholder={aiConfig.hasApiKey ? `****${aiConfig.apiKeyLast4}` : "sk-..."}
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                />
              </div>
            </div>

            {/* Limits */}
            <div className="border-t border-border p-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Limits
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Requests</label>
                  <Input
                    className="mt-1 text-sm"
                    type="number"
                    value={aiConfig.rateLimitMax}
                    onChange={(e) =>
                      setAiConfig({ ...aiConfig, rateLimitMax: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Window (sec)</label>
                  <Input
                    className="mt-1 text-sm"
                    type="number"
                    value={aiConfig.rateLimitWindowSeconds}
                    onChange={(e) =>
                      setAiConfig({
                        ...aiConfig,
                        rateLimitWindowSeconds: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Max tool rounds</label>
                  <Input
                    className="mt-1 text-sm"
                    type="number"
                    value={aiConfig.maxToolRounds}
                    onChange={(e) =>
                      setAiConfig({ ...aiConfig, maxToolRounds: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Context tokens</label>
                  <Input
                    className="mt-1 text-sm"
                    type="number"
                    value={aiConfig.maxContextTokens}
                    onChange={(e) =>
                      setAiConfig({ ...aiConfig, maxContextTokens: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Max tokens</label>
                  <Input
                    className="mt-1 text-sm"
                    type="number"
                    value={aiConfig.maxCompletionTokens}
                    onChange={(e) =>
                      setAiConfig({ ...aiConfig, maxCompletionTokens: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Token field</label>
                  <Select
                    value={aiConfig.maxTokensField || "max_completion_tokens"}
                    onValueChange={(v) => setAiConfig({ ...aiConfig, maxTokensField: v })}
                  >
                    <SelectTrigger className="mt-1 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem>
                      <SelectItem value="max_tokens">max_tokens</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* System Prompt */}
            <div className="border-t border-r border-border p-4 flex flex-col gap-3 max-sm:border-r-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                System Prompt
              </p>
              <Textarea
                className="min-h-[120px] flex-1 resize-none"
                placeholder="Add custom instructions for the AI assistant.&#10;&#10;Examples:&#10;- Company PKI policies and naming conventions&#10;- Preferred certificate settings&#10;- Security guidelines"
                value={aiConfig.customSystemPrompt}
                onChange={(e) => setAiConfig({ ...aiConfig, customSystemPrompt: e.target.value })}
              />
            </div>

            {/* Tools & Web Search */}
            <div className="border-t border-border p-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Tools
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Tool Access</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {aiConfig.disabledTools.length > 0
                      ? `${aiConfig.disabledTools.length} tool${aiConfig.disabledTools.length !== 1 ? "s" : ""} disabled`
                      : "All tools enabled"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-fit shrink-0 text-xs"
                  onClick={() => setAiToolsModalOpen(true)}
                >
                  Manage
                </Button>
              </div>
              <Separator />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Web Search</p>
                  {aiConfig.disabledTools.includes("web_search") && (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                  Allow the AI to search the web for information
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Provider</label>
                    <Select
                      value={aiConfig.webSearchProvider || "tavily"}
                      onValueChange={(v) => setAiConfig({ ...aiConfig, webSearchProvider: v })}
                    >
                      <SelectTrigger className="mt-1 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tavily">Tavily — AI-optimized search</SelectItem>
                        <SelectItem value="brave">Brave Search — privacy-first</SelectItem>
                        <SelectItem value="serper">Serper — Google results</SelectItem>
                        <SelectItem value="exa">Exa — semantic search</SelectItem>
                        <SelectItem value="searxng">SearXNG — self-hosted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {aiConfig.webSearchProvider === "searxng" ? (
                    <div>
                      <label className="text-xs text-muted-foreground">Instance URL</label>
                      <Input
                        className="mt-1 text-sm"
                        placeholder="https://searxng.example.com"
                        value={aiConfig.webSearchBaseUrl}
                        onChange={(e) =>
                          setAiConfig({ ...aiConfig, webSearchBaseUrl: e.target.value })
                        }
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-muted-foreground">API Key</label>
                      <Input
                        className="mt-1 text-sm"
                        type="password"
                        placeholder={
                          aiConfig.hasWebSearchKey
                            ? "Configured — enter new to replace"
                            : "Enter API key"
                        }
                        value={aiWebSearchKey}
                        onChange={(e) => setAiWebSearchKey(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </PanelShell>

      <AIToolAccessModal
        open={aiToolsModalOpen}
        onOpenChange={setAiToolsModalOpen}
        disabledTools={aiConfig.disabledTools}
        onSave={(disabledTools) =>
          setAiConfig((current) => (current ? { ...current, disabledTools } : current))
        }
      />
    </>
  );
}
