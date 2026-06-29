import type { ResourceListFolderConfig } from "./types";

export function countFolderItems<TFolder, TItem>(
  folder: TFolder,
  config: ResourceListFolderConfig<TFolder, TItem>
): number {
  return (
    config.getFolderItems(folder).length +
    config
      .getFolderChildren(folder)
      .reduce((count, child) => count + countFolderItems(child, config), 0)
  );
}
