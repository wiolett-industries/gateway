import { create } from "zustand";
import type { CA } from "@/types";
import { api } from "@/services/api";

interface CAState {
  cas: CA[];
  selectedCA: CA | null;
  isLoading: boolean;
  error: string | null;

  fetchCAs: () => Promise<void>;
  selectCA: (id: string) => Promise<void>;
  clearSelected: () => void;
  setCAs: (cas: CA[]) => void;
}

export const useCAStore = create<CAState>()((set, get) => ({
  cas: [],
  selectedCA: null,
  isLoading: false,
  error: null,

  fetchCAs: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.listCAs();
      set({ cas: response.data, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch CAs";
      set({ error: message, isLoading: false });
    }
  },

  selectCA: async (id: string) => {
    // First check if we already have it
    const existing = get().cas.find((ca) => ca.id === id);
    if (existing) {
      set({ selectedCA: existing });
    }
    try {
      const ca = await api.getCA(id);
      set({ selectedCA: ca });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch CA";
      set({ error: message });
    }
  },

  clearSelected: () => set({ selectedCA: null }),

  setCAs: (cas) => set({ cas }),
}));
