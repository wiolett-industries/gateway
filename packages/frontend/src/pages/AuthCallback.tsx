import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      const sessionId = searchParams.get("session");
      const errorParam = searchParams.get("error");

      if (errorParam) {
        setError(errorParam);
        return;
      }

      if (!sessionId) {
        setError("No session token received");
        return;
      }

      try {
        // Store the session ID first so API calls include it
        useAuthStore.getState().setSessionId(sessionId);

        // Fetch the current user
        const user = await api.getCurrentUser();
        login(user, sessionId);
        navigate("/", { replace: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        setError(message);
      }
    };

    handleCallback();
  }, [searchParams, login, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <h2 className="text-lg font-semibold text-foreground">Authentication Failed</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate("/login")}
            className="mt-2 border border-border px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Authenticating...</p>
      </div>
    </div>
  );
}
