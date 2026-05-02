export type ProxyHostLike = Record<string, unknown>;

export function stripRawProxyConfigForProgrammatic<T extends ProxyHostLike>(
  host: T
): Omit<T, 'rawConfig' | 'rawConfigEnabled'> {
  const { rawConfig: _rawConfig, rawConfigEnabled: _rawConfigEnabled, ...rest } = host;
  return rest;
}

export function stripRawProxyConfigArrayForProgrammatic<T extends ProxyHostLike>(
  hosts: T[]
): Array<Omit<T, 'rawConfig' | 'rawConfigEnabled'>> {
  return hosts.map((host) => stripRawProxyConfigForProgrammatic(host));
}

export function redactRawProxyConfigForBrowser<T extends ProxyHostLike>(
  host: T
): Omit<T, 'rawConfig'> & { rawConfig: null } {
  return { ...host, rawConfig: null };
}

export function redactRawProxyConfigArrayForBrowser<T extends ProxyHostLike>(
  hosts: T[],
  canReadRawConfig: (host: T) => boolean
): Array<T | (Omit<T, 'rawConfig'> & { rawConfig: null })> {
  return hosts.map((host) => (canReadRawConfig(host) ? host : redactRawProxyConfigForBrowser(host)));
}

export function stripGroupedRawProxyConfigForProgrammaticResponse<
  T extends {
    folders: unknown[];
    ungroupedHosts: ProxyHostLike[];
  },
>(result: T): T {
  const stripFolder = (folder: any): any => ({
    ...folder,
    hosts: stripRawProxyConfigArrayForProgrammatic(folder.hosts ?? []),
    children: (folder.children ?? []).map(stripFolder),
  });

  return {
    ...result,
    folders: result.folders.map(stripFolder),
    ungroupedHosts: stripRawProxyConfigArrayForProgrammatic(result.ungroupedHosts),
  };
}

export function stripFolderTreeRawProxyConfigForProgrammaticResponse<T extends unknown[]>(tree: T): T {
  const stripFolder = (folder: any): any => ({
    ...folder,
    hosts: stripRawProxyConfigArrayForProgrammatic(folder.hosts ?? []),
    children: (folder.children ?? []).map(stripFolder),
  });

  return tree.map(stripFolder) as T;
}

export function redactGroupedRawProxyConfigForBrowserResponse<
  T extends {
    folders: unknown[];
    ungroupedHosts: ProxyHostLike[];
  },
>(result: T, canReadRawConfig: (host: ProxyHostLike) => boolean): T {
  const redactFolder = (folder: any): any => ({
    ...folder,
    hosts: redactRawProxyConfigArrayForBrowser(folder.hosts ?? [], canReadRawConfig),
    children: (folder.children ?? []).map(redactFolder),
  });

  return {
    ...result,
    folders: result.folders.map(redactFolder),
    ungroupedHosts: redactRawProxyConfigArrayForBrowser(result.ungroupedHosts, canReadRawConfig),
  };
}

export function redactFolderTreeRawProxyConfigForBrowserResponse<T extends unknown[]>(
  tree: T,
  canReadRawConfig: (host: ProxyHostLike) => boolean
): T {
  const redactFolder = (folder: any): any => ({
    ...folder,
    hosts: redactRawProxyConfigArrayForBrowser(folder.hosts ?? [], canReadRawConfig),
    children: (folder.children ?? []).map(redactFolder),
  });

  return tree.map(redactFolder) as T;
}
