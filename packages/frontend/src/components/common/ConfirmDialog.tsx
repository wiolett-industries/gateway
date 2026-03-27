import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: "default" | "destructive";
  onConfirm: (() => void) | null;
  show: (opts: {
    title: string;
    description: string;
    confirmLabel?: string;
    variant?: "default" | "destructive";
    onConfirm: () => void;
  }) => void;
  close: () => void;
}

export const useConfirmDialog = create<ConfirmState>()((set) => ({
  open: false,
  title: "",
  description: "",
  confirmLabel: "Confirm",
  variant: "default",
  onConfirm: null,
  show: ({ title, description, confirmLabel = "Confirm", variant = "destructive", onConfirm }) =>
    set({ open: true, title, description, confirmLabel, variant, onConfirm }),
  close: () => set({ open: false, onConfirm: null }),
}));

export function confirm(opts: {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "default" | "destructive";
}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmDialog.getState().show({
      ...opts,
      onConfirm: () => {
        resolve(true);
        useConfirmDialog.getState().close();
      },
    });
    const unsub = useConfirmDialog.subscribe((state) => {
      if (!state.open) {
        resolve(false);
        unsub();
      }
    });
  });
}

export function ConfirmDialog() {
  const { open, title, description, confirmLabel, variant, onConfirm, close } =
    useConfirmDialog();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={() => {
              onConfirm?.();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
