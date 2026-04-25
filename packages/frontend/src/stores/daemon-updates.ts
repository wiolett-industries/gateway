import { create } from "zustand";
import { api } from "@/services/api";
import type { DaemonUpdateStatus } from "@/types";

interface DaemonUpdatesState {
  statuses: DaemonUpdateStatus[];
  isLoading: boolean;
  error: string | null;
  lastLoadedAt: number;
  fetchDaemonUpdates: (options?: { force?: boolean }) => Promise<DaemonUpdateStatus[]>;
  setDaemonUpdates: (statuses: DaemonUpdateStatus[]) => void;
}

const FRESH_MS = 10_000;
let inFlight: Promise<DaemonUpdateStatus[]> | null = null;

export const useDaemonUpdatesStore = create<DaemonUpdatesState>()((set, get) => ({
  statuses: [],
  isLoading: false,
  error: null,
  lastLoadedAt: 0,

  fetchDaemonUpdates: async (options = {}) => {
    const now = Date.now();
    const { statuses, lastLoadedAt } = get();

    if (!options.force && statuses.length > 0 && now - lastLoadedAt < FRESH_MS) {
      return statuses;
    }

    if (inFlight) return inFlight;

    set({ isLoading: true, error: null });
    inFlight = api
      .getDaemonUpdates()
      .then((data) => {
        set({
          statuses: data,
          isLoading: false,
          error: null,
          lastLoadedAt: Date.now(),
        });
        return data;
      })
      .catch((err) => {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to load daemon updates",
        });
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  },

  setDaemonUpdates: (statuses) => {
    set({
      statuses,
      isLoading: false,
      error: null,
      lastLoadedAt: Date.now(),
    });
  },
}));
