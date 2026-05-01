import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerAuthContextReset } from "@/stores/auth";
import { resetClientSessionState } from "@/stores/session-reset";
import App from "./App";
import "./index.css";

registerAuthContextReset(resetClientSessionState);

// Strip cache-bust param added by update reload
if (window.location.search.includes("_v=")) {
  window.history.replaceState(null, "", window.location.pathname);
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
