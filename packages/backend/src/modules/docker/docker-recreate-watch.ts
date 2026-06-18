export function dockerDispatchErrorMessage(result: { error?: string; detail?: string }, fallback: string) {
  if (typeof result.error === 'string' && result.error.trim()) return result.error.trim();
  if (typeof result.detail === 'string' && result.detail.trim()) return result.detail.trim();
  return fallback;
}

export function getReplacementContainerFailureMessage(
  container: {
    id?: string;
    Id?: string;
    state?: string;
    State?: string;
    status?: string;
    Status?: string;
  },
  oldContainerId: string,
  expectedState: string
) {
  const newId = container.id ?? container.Id;
  const state = String(container.state ?? container.State ?? '').toLowerCase();
  const status = String(container.status ?? container.Status ?? '');
  const normalizedExpectedState = String(expectedState).toLowerCase();

  if (newId === oldContainerId) return null;
  if (!['exited', 'dead'].includes(state) || state === normalizedExpectedState) return null;

  return `Replacement container failed to start (${status || state})`;
}
