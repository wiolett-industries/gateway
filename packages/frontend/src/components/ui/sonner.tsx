"use client";

import type { ToasterProps } from "sonner";
import { Toaster as SonnerToaster } from "sonner";

/** Shadcn-style Sonner: dark gray toasts like tooltips. Close button to dismiss. */
function Toaster(props: ToasterProps) {
  return <SonnerToaster theme="dark" closeButton {...props} />;
}

export { Toaster };
