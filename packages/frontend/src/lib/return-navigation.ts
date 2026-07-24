type LocationParts = {
  pathname: string;
  search?: string;
  hash?: string;
};

type ReturnNavigationState = {
  returnTo?: unknown;
};

export function createReturnNavigationState(location: LocationParts) {
  return {
    returnTo: `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`,
  };
}

export function getReturnNavigationTarget(state: unknown, fallback: string) {
  const returnTo = (state as ReturnNavigationState | null)?.returnTo;
  return typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : fallback;
}

export function preserveReturnNavigationState(state: unknown) {
  const returnTo = (state as ReturnNavigationState | null)?.returnTo;
  return typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? { returnTo }
    : {};
}
