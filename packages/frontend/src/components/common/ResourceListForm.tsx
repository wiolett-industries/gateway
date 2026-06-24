import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { ResourceListFrame, ResourceListHeaderTable } from "@/components/common/ResourceListLayout";
import { ResourceDragOverlay } from "@/components/common/resource-list/ResourceDragOverlay";
import { ResourceFolderGroup } from "@/components/common/resource-list/ResourceFolderGroup";
import { ResourceUngroupedSection } from "@/components/common/resource-list/ResourceUngroupedSection";
import type { ResourceListFormProps } from "@/components/common/resource-list/types";
import { SearchFilterBar } from "@/components/common/SearchFilterBar";

export function ResourceListForm<TFolder, TItem>({
  columns,
  search,
  folders,
  items,
  dnd,
  minWidth = 900,
  loading,
  loadingLabel = "Loading...",
  hasContent,
  emptyState,
  afterSearch,
}: ResourceListFormProps<TFolder, TItem>) {
  const topLevelFolders = folders.folders;
  const ungroupedItems = folders.ungroupedItems;
  const showLoading = loading && !hasContent;
  const frame = (
    <ResourceListFrame minWidth={minWidth}>
      <ResourceListHeaderTable columns={columns} />
      {topLevelFolders.length > 0 && (
        <SortableContext
          items={topLevelFolders.map(folders.getFolderSortableId)}
          strategy={verticalListSortingStrategy}
        >
          {topLevelFolders.map((folder) => (
            <ResourceFolderGroup
              key={folders.getFolderId(folder)}
              folder={folder}
              depth={folders.getFolderDepth?.(folder) ?? 0}
              columns={columns}
              folderConfig={folders}
              itemConfig={items}
            />
          ))}
        </SortableContext>
      )}
      {(topLevelFolders.length > 0 || ungroupedItems.length > 0) && (
        <ResourceUngroupedSection
          columns={columns}
          items={ungroupedItems}
          itemConfig={items}
          folderConfig={folders}
          showHeader={topLevelFolders.length > 0}
        />
      )}
    </ResourceListFrame>
  );

  return (
    <div className="space-y-3">
      <SearchFilterBar {...search} />
      {afterSearch}
      {showLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner className="" />
            <p className="text-sm text-muted-foreground">{loadingLabel}</p>
          </div>
        </div>
      ) : hasContent ? (
        <DndContext
          sensors={dnd?.sensors}
          onDragStart={dnd?.onDragStart}
          onDragEnd={dnd?.onDragEnd}
          onDragCancel={dnd?.onDragCancel}
        >
          {frame}
          {dnd && (
            <ResourceDragOverlay
              active={dnd.active}
              columns={columns}
              folderConfig={folders}
              itemConfig={items}
            />
          )}
        </DndContext>
      ) : (
        emptyState
      )}
    </div>
  );
}
