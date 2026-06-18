type ProxyApi = {
  updateProxyHost: (
    hostId: string,
    payload: { advancedConfig?: string | null; accessListId?: string | null }
  ) => Promise<any>;
};

export async function saveProxyHostAdvancedConfig(
  proxyApi: ProxyApi,
  hostId: string,
  advancedConfig: string
) {
  return proxyApi.updateProxyHost(hostId, {
    advancedConfig: advancedConfig === "" ? null : advancedConfig,
  });
}

export async function saveProxyHostAccessList(
  proxyApi: ProxyApi,
  hostId: string,
  accessListId: string
) {
  return proxyApi.updateProxyHost(hostId, {
    accessListId: accessListId === "" ? null : accessListId,
  });
}
