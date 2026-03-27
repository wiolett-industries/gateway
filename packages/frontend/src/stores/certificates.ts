import { create } from "zustand";
import type { Certificate, CertificateStatus, CertificateType } from "@/types";
import { api } from "@/services/api";

interface CertificateFilters {
  search: string;
  status: CertificateStatus | "all";
  type: CertificateType | "all";
  caId: string | "all";
}

interface CertificatesState {
  certificates: Certificate[];
  selectedCertificate: Certificate | null;
  isLoading: boolean;
  error: string | null;
  filters: CertificateFilters;
  page: number;
  limit: number;
  total: number;
  totalPages: number;

  fetchCertificates: () => Promise<void>;
  selectCertificate: (id: string) => Promise<void>;
  clearSelected: () => void;
  setFilters: (filters: Partial<CertificateFilters>) => void;
  setPage: (page: number) => void;
  resetFilters: () => void;
}

const defaultFilters: CertificateFilters = {
  search: "",
  status: "all",
  type: "all",
  caId: "all",
};

export const useCertificatesStore = create<CertificatesState>()((set, get) => ({
  certificates: [],
  selectedCertificate: null,
  isLoading: false,
  error: null,
  filters: { ...defaultFilters },
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 0,

  fetchCertificates: async () => {
    const { filters, page, limit } = get();
    set({ isLoading: true, error: null });
    try {
      const response = await api.listCertificates({
        page,
        limit,
        search: filters.search || undefined,
        status: filters.status !== "all" ? filters.status : undefined,
        type: filters.type !== "all" ? filters.type : undefined,
        caId: filters.caId !== "all" ? filters.caId : undefined,
      });
      set({
        certificates: response.data || [],
        total: response.pagination?.total ?? 0,
        totalPages: response.pagination?.totalPages ?? 0,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch certificates";
      set({ error: message, isLoading: false });
    }
  },

  selectCertificate: async (id: string) => {
    try {
      const cert = await api.getCertificate(id);
      set({ selectedCertificate: cert });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch certificate";
      set({ error: message });
    }
  },

  clearSelected: () => set({ selectedCertificate: null }),

  setFilters: (newFilters) => {
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
      page: 1,
    }));
    get().fetchCertificates();
  },

  setPage: (page) => {
    set({ page });
    get().fetchCertificates();
  },

  resetFilters: () => {
    set({ filters: { ...defaultFilters }, page: 1 });
    get().fetchCertificates();
  },
}));
