import { ArrowLeft, Check, Eye, FlaskConical, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { useRealtime } from "@/hooks/use-realtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import type { ProxyHostType, TemplateVariableDef } from "@/types";

const VARIABLE_REFERENCE = `Available variables:
{{id}}              Host UUID
{{serverNames}}     Space-separated domains
{{upstream}}        scheme://host:port
{{forwardScheme}}   http or https
{{forwardHost}}     Upstream hostname
{{forwardPort}}     Upstream port
{{sslEnabled}}      Boolean
{{sslForced}}       Boolean
{{http2Support}}    Boolean
{{websocketSupport}} Boolean
{{sslCertPath}}     SSL cert file path
{{sslKeyPath}}      SSL key file path
{{sslChainPath}}    SSL chain file path
{{redirectUrl}}     Redirect target URL
{{redirectStatusCode}} 301/302/307/308
{{cacheEnabled}}    Boolean
{{cacheMaxAge}}     Seconds
{{rateLimitEnabled}} Boolean
{{rateLimitRPS}}    Requests/sec
{{rateLimitBurst}}  Burst size
{{logPath}}         Log file base path
{{advancedConfig}}  Raw advanced config

Arrays (use {{#each}}):
{{#each customHeaders}}
  {{this.name}} {{this.value}}
{{/each}}
{{#each customRewrites}}
  {{this.source}} {{this.destination}} {{this.type}}
{{/each}}
{{#each accessList.ipRules}}
  {{this.type}} {{this.value}}
{{/each}}

Conditionals:
{{#if sslEnabled}} ... {{/if}}
{{#unless sslForced}} ... {{/unless}}

Helpers:
{{sanitize value}} — strips dangerous chars
{{#if (eq a b)}} — equality check`;

export function NginxTemplateEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [isBuiltin, setIsBuiltin] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ProxyHostType>("proxy");
  const [content, setContent] = useState("");
  const [variables, setVariables] = useState<TemplateVariableDef[]>([]);

  // Preview
  const [showPreview, setShowPreview] = useState(false);
  const [previewResult, setPreviewResult] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Test
  const [testResult, setTestResult] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [showReference, setShowReference] = useState(false);

  const loadTemplate = useCallback(async () => {
    if (isNew || !id) return;
    setIsLoading(true);
    try {
      const t = await api.getNginxTemplate(id);
      setName(t.name);
      setDescription(t.description || "");
      setType(t.type);
      setContent(t.content);
      setVariables(t.variables || []);
      setIsBuiltin(t.isBuiltin);
    } catch {
      toast.error("Failed to load template");
      navigate("/nginx-templates");
    } finally {
      setIsLoading(false);
    }
  }, [id, isNew, navigate]);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  useRealtime(!isNew ? "nginx.template.changed" : null, (payload) => {
    const event = payload as { id?: string; action?: string } | undefined;
    if (!id || (event?.id && event.id !== id)) return;
    if (event?.action === "deleted") {
      toast.error("Template was deleted");
      navigate("/nginx-templates");
      return;
    }
    loadTemplate();
  });

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!content.trim()) {
      toast.error("Template content is required");
      return;
    }

    setIsSaving(true);
    try {
      if (isNew) {
        const validVars = variables.filter((v) => v.name.trim());
        const t = await api.createNginxTemplate({
          name,
          description: description || undefined,
          type,
          content,
          variables: validVars,
        });
        toast.success("Template created");
        navigate(`/nginx-templates/${t.id}`, { replace: true });
      } else {
        const validVars = variables.filter((v) => v.name.trim());
        await api.updateNginxTemplate(id!, {
          name,
          description: description || null,
          content,
          variables: validVars,
        });
        toast.success("Template saved");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async () => {
    setIsPreviewLoading(true);
    setShowPreview(true);
    try {
      const result = await api.previewNginxTemplate(content);
      setPreviewResult(result.rendered);
    } catch (err) {
      setPreviewResult(`Error: ${err instanceof Error ? err.message : "Preview failed"}`);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const result = await api.testNginxTemplate(content);
      setTestResult({ valid: result.valid, errors: result.errors });
      if (result.valid) {
        toast.success("Config test passed");
      } else {
        toast.error("Config test failed");
      }
    } catch (err) {
      setTestResult({ valid: false, errors: [err instanceof Error ? err.message : "Test failed"] });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <LoadingSpinner />
    );
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/nginx-templates")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{isNew ? "Create Config Template" : name}</h1>
              <p className="text-sm text-muted-foreground">
                {isNew
                  ? "Define a Handlebars nginx server block template"
                  : isBuiltin
                    ? "Built-in template (read-only)"
                    : "Edit nginx config template"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowReference(!showReference)}>
              {showReference ? "Hide" : "Variables"}
            </Button>
            <Button variant="outline" size="sm" onClick={handlePreview} disabled={!content.trim()}>
              <Eye className="h-4 w-4" />
              Preview
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!content.trim() || isTesting}
            >
              <FlaskConical className="h-4 w-4" />
              {isTesting ? "Testing..." : "Test"}
            </Button>
            {!isBuiltin && (
              <Button onClick={handleSave} disabled={isSaving || !name.trim() || !content.trim()}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
        </div>

        {/* Test result banner */}
        {testResult && (
          <div
            className={`flex items-center gap-2 p-3 border ${testResult.valid ? "border-green-600/30 bg-green-600/5" : "border-destructive/30 bg-destructive/5"}`}
          >
            {testResult.valid ? (
              <>
                <Check className="h-4 w-4 text-green-600" />
                <span className="text-sm text-green-600">nginx -t passed</span>
              </>
            ) : (
              <>
                <X className="h-4 w-4 text-destructive" />
                <span className="text-sm text-destructive">
                  nginx -t failed: {testResult.errors.join(", ")}
                </span>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              onClick={() => setTestResult(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Meta fields */}
        <div className="flex gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isBuiltin}
              placeholder="Template name"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBuiltin}
              placeholder="Optional description"
            />
          </div>
          <div className="w-40 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Host Type</label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ProxyHostType)}
              disabled={!isNew}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="proxy">Proxy</SelectItem>
                <SelectItem value="redirect">Redirect</SelectItem>
                <SelectItem value="404">404</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Editor + panels */}
        <div className="flex gap-4">
          {/* Editor */}
          <div className="flex-1 min-w-0">
            <CodeEditor
              value={content}
              onChange={setContent}
              readOnly={isBuiltin}
              minHeight="500px"
            />
          </div>

          {/* Variable reference panel */}
          {showReference && (
            <div
              className="w-72 shrink-0 border border-border bg-card overflow-y-auto"
              style={{ maxHeight: "540px" }}
            >
              <div className="p-3 border-b border-border">
                <h3 className="text-sm font-semibold">Variable Reference</h3>
              </div>
              <pre className="p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {VARIABLE_REFERENCE}
              </pre>
            </div>
          )}
        </div>

        {/* Variables schema */}
        {!isBuiltin && (
          <div className="border border-border bg-card">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold">Custom Variables</h3>
                <p className="text-xs text-muted-foreground">
                  Define variables that proxy hosts can fill in when using this template. Use them
                  as <code className="bg-muted px-1">{"{{variableName}}"}</code> in the template.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setVariables([...variables, { name: "", type: "string", description: "" }])
                }
              >
                <Plus className="h-4 w-4" /> Add Variable
              </Button>
            </div>
            {variables.length > 0 && (
              <div className="p-3 space-y-2">
                {variables.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={v.name}
                      onChange={(e) => {
                        const next = [...variables];
                        next[i] = { ...next[i], name: e.target.value };
                        setVariables(next);
                      }}
                      placeholder="Variable name"
                      className="w-40 font-mono text-xs"
                    />
                    <Select
                      value={v.type}
                      onValueChange={(val) => {
                        const next = [...variables];
                        next[i] = { ...next[i], type: val as "string" | "number" | "boolean" };
                        setVariables(next);
                      }}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">String</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="boolean">Boolean</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={String(v.default ?? "")}
                      onChange={(e) => {
                        const next = [...variables];
                        const raw = e.target.value;
                        next[i] = {
                          ...next[i],
                          default:
                            v.type === "number"
                              ? raw
                                ? Number(raw)
                                : undefined
                              : v.type === "boolean"
                                ? raw === "true"
                                : raw || undefined,
                        };
                        setVariables(next);
                      }}
                      placeholder="Default"
                      className="w-28 text-xs"
                    />
                    <Input
                      value={v.description || ""}
                      onChange={(e) => {
                        const next = [...variables];
                        next[i] = { ...next[i], description: e.target.value || undefined };
                        setVariables(next);
                      }}
                      placeholder="Description"
                      className="flex-1 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setVariables(variables.filter((_, j) => j !== i))}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Preview panel */}
        {showPreview && (
          <div className="border border-border bg-card">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <h3 className="text-sm font-semibold">Rendered Preview</h3>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  Sample data
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setShowPreview(false)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {isPreviewLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Rendering...</div>
            ) : (
              <pre className="p-4 text-xs font-mono overflow-x-auto whitespace-pre">
                {previewResult}
              </pre>
            )}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
