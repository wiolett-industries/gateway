// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// API Error
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
