import { AlertTriangle, RotateCw, ServerCrash } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStatusStore } from "@/stores/app-status";
import { useAuthStore } from "@/stores/auth";

function MaintenanceScreen() {
  const setMaintenanceActive = useAppStatusStore((s) => s.setMaintenanceActive);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch("/health", { cache: "no-store" });
        if (response.ok) {
          setMaintenanceActive(false);
        }
      } catch {
        // Keep the maintenance screen visible until the backend answers again.
      }
    };

    void checkHealth();
    const interval = window.setInterval(() => {
      void checkHealth();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [setMaintenanceActive]);

  return (
    <div className="fixed inset-0 z-[200] flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center border border-destructive/30 bg-destructive/5">
            <ServerCrash className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Temporarily Unavailable</h2>
          <p className="text-sm text-muted-foreground">
            The backend is not responding right now. Your session is preserved.
          </p>
        </div>

        <div className="space-y-3">
          <Button onClick={() => window.location.reload()} className="w-full">
            <RotateCw className="mr-2 h-4 w-4" />
            Reload now
          </Button>
          <p className="text-xs text-muted-foreground">Automatic retry is active.</p>
        </div>
      </div>
    </div>
  );
}

function GatewayUpdatingScreen() {
  const targetVersion = useAppStatusStore((s) => s.gatewayUpdatingTargetVersion);
  const clearGatewayUpdating = useAppStatusStore((s) => s.clearGatewayUpdating);
  const sessionId = useAuthStore((s) => s.sessionId);

  useEffect(() => {
    let seenUnavailable = false;

    const checkHealth = async () => {
      try {
        const response = await fetch("/health", { cache: "no-store" });
        if (!response.ok) {
          seenUnavailable = true;
          return;
        }

        if (sessionId && targetVersion) {
          const versionResponse = await fetch("/api/system/version", {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${sessionId}`,
            },
          });
          if (versionResponse.ok) {
            const payload = (await versionResponse.json()) as {
              data?: { currentVersion?: string };
            };
            if (payload.data?.currentVersion === targetVersion) {
              clearGatewayUpdating();
              window.location.reload();
              return;
            }
          }
        }

        if (seenUnavailable) {
          clearGatewayUpdating();
          window.location.reload();
        }
      } catch {
        seenUnavailable = true;
      }
    };

    const interval = window.setInterval(() => {
      void checkHealth();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [clearGatewayUpdating, sessionId, targetVersion]);

  return (
    <div className="fixed inset-0 z-[205] flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center border border-amber-500/30 bg-amber-500/5 text-amber-600">
            <RotateCw className="h-6 w-6 animate-spin" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Updating Gateway</h2>
          <p className="text-sm text-muted-foreground">
            {targetVersion
              ? `Gateway is updating to ${targetVersion}.`
              : "Gateway is applying an update."}{" "}
            All actions are temporarily locked until the restart completes.
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">This page will reload automatically.</p>
        </div>
      </div>
    </div>
  );
}

function RateLimitScreen() {
  const rateLimitedUntil = useAppStatusStore((s) => s.rateLimitedUntil);
  const clearRateLimit = useAppStatusStore((s) => s.clearRateLimit);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  useEffect(() => {
    if (!rateLimitedUntil) {
      setSecondsRemaining(0);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        clearRateLimit();
        window.location.reload();
      }
    };

    updateRemaining();
    const interval = window.setInterval(updateRemaining, 250);
    return () => window.clearInterval(interval);
  }, [clearRateLimit, rateLimitedUntil]);

  if (rateLimitedUntil == null) return null;

  return (
    <div className="fixed inset-0 z-[210] flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center border border-amber-500/30 bg-amber-500/5 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Rate Limit Reached</h2>
          <p className="text-sm text-muted-foreground">
            You have been rate-limited. The page will reload automatically in{" "}
            <span className="font-semibold text-foreground">{secondsRemaining}</span> second
            {secondsRemaining === 1 ? "" : "s"}.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AppStatusGate() {
  const maintenanceActive = useAppStatusStore((s) => s.maintenanceActive);
  const gatewayUpdatingActive = useAppStatusStore((s) => s.gatewayUpdatingActive);
  const rateLimitedUntil = useAppStatusStore((s) => s.rateLimitedUntil);
  const [showMaintenanceScreen, setShowMaintenanceScreen] = useState(false);

  useEffect(() => {
    if (!maintenanceActive) {
      setShowMaintenanceScreen(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowMaintenanceScreen(true);
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [maintenanceActive]);

  if (rateLimitedUntil != null) return <RateLimitScreen />;
  if (gatewayUpdatingActive) return <GatewayUpdatingScreen />;
  if (showMaintenanceScreen) return <MaintenanceScreen />;
  return null;
}
