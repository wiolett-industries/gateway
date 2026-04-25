import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { DetailRow } from "@/components/common/DetailRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/services/api";
import { useUpdateStore } from "@/stores/update";

interface UpdateSectionProps {
  canUpdate: boolean;
}

export function UpdateSection({ canUpdate }: UpdateSectionProps) {
  const {
    status: updateStatus,
    isChecking,
    isUpdating,
    checkForUpdates,
    triggerUpdate,
    fetchStatus,
  } = useUpdateStore();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [releaseNotesList, setReleaseNotesList] = useState<string[] | null>(null);
  const [releaseVersions, setReleaseVersions] = useState<string[] | null>(null);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleCheckUpdate = async () => {
    await checkForUpdates();
    const s = useUpdateStore.getState().status;
    if (s?.updateAvailable) {
      toast.info(`Update available: ${s.latestVersion}`);
    } else {
      toast.success("Already up to date");
    }
  };

  const handleUpdate = async () => {
    if (!updateStatus?.latestVersion) return;
    const ok = await confirm({
      title: "Update Gateway",
      description: `Update from ${updateStatus.currentVersion} to ${updateStatus.latestVersion}? The application will restart automatically.`,
      confirmLabel: "Update",
    });
    if (!ok) return;
    triggerUpdate(updateStatus.latestVersion);
  };

  return (
    <>
      {/* Update available */}
      {updateStatus?.updateAvailable && updateStatus.latestVersion && (
        <div
          className="border bg-card xl:col-span-2"
          style={{ borderColor: "rgb(234 179 8 / 0.6)" }}
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h2 className="font-semibold" style={{ color: "rgb(234 179 8)" }}>
                Update Available
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {updateStatus.latestVersion} is ready to install
              </p>
            </div>
            <div className="flex items-center gap-2">
              {updateStatus.releaseNotes && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setReleaseNotesOpen(true);
                    try {
                      const all = await api.getAllReleaseNotes();
                      if (all.length > 0) {
                        setReleaseVersions(all.map((r) => r.version));
                        setReleaseNotesList(all.map((r) => r.notes));
                      }
                    } catch {
                      // Fallback: just show the cached latest release notes
                    }
                  }}
                >
                  Release notes
                </Button>
              )}
              {canUpdate && (
                <Button
                  size="sm"
                  onClick={handleUpdate}
                  style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
                  className="hover:opacity-90"
                >
                  Update to {updateStatus.latestVersion}
                </Button>
              )}
            </div>
          </div>
          <div className="divide-y divide-border">
            <DetailRow label="Current version" value={updateStatus.currentVersion} />
            <DetailRow label="New version" value={updateStatus.latestVersion} />
          </div>
        </div>
      )}

      {/* About */}
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold">About</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Application info and updates</p>
          </div>
          {canUpdate && (
            <Button size="sm" onClick={handleCheckUpdate} disabled={isChecking}>
              {isChecking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Check for updates
            </Button>
          )}
        </div>
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-4">
            <img src="/android-chrome-192x192.png" alt="Gateway" className="h-10 w-10" />
            <div>
              <p className="text-sm font-semibold">Gateway</p>
              <p className="text-xs text-muted-foreground">
                Self-hosted certificate manager and reverse proxy gateway
              </p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
          <DetailRow label="Version" value={updateStatus?.currentVersion ?? "..."} />
          <DetailRow
            label="Status"
            value={
              updateStatus?.updateAvailable ? (
                <Badge variant="warning" className="text-xs">
                  Update available
                </Badge>
              ) : (
                <Badge variant="success" className="text-xs">
                  Up to date
                </Badge>
              )
            }
          />
          {updateStatus?.lastCheckedAt && (
            <DetailRow
              label="Last checked"
              value={new Date(updateStatus.lastCheckedAt).toLocaleString()}
            />
          )}
        </div>
      </div>

      {/* Updating overlay */}
      {isUpdating &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">Updating Gateway</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Updating to {updateStatus?.latestVersion}. The application will restart
                  automatically.
                </p>
                <p className="text-xs text-muted-foreground mt-3">This may take a minute...</p>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Release Notes Dialog */}
      <Dialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Release Notes</DialogTitle>
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {(releaseNotesList ?? [updateStatus?.releaseNotes]).filter(Boolean).map((notes, i) => (
              <div key={i}>
                {releaseNotesList && releaseNotesList.length > 1 && (
                  <h3 className="text-base font-semibold mt-0">{releaseVersions?.[i]}</h3>
                )}
                <Markdown>{notes ?? ""}</Markdown>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
