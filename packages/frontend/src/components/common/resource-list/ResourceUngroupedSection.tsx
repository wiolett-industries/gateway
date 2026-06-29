import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  type ResourceListColumn,
  ResourceListSectionHeader,
  ResourceListTable,
} from "@/components/common/ResourceListLayout";
import { ResourceListItemRow } from "./ResourceListItemRow";
import type { ResourceListFolderConfig, ResourceListItemConfig } from "./types";

interface ResourceUngroupedSectionProps<TItem> {
  columns: ResourceListColumn<TItem>[];
  items: TItem[];
  itemConfig: ResourceListItemConfig<TItem>;
  folderConfig: Pick<
    ResourceListFolderConfig<unknown, TItem>,
    "ungroupedDroppable" | "ungroupedLabel"
  >;
  showHeader: boolean;
}

export function ResourceUngroupedSection<TItem>({
  columns,
  items,
  itemConfig,
  folderConfig,
  showHeader,
}: ResourceUngroupedSectionProps<TItem>) {
  const { setNodeRef, isOver } = useDroppable({
    id: folderConfig.ungroupedDroppable?.id ?? "resource-list-ungrouped",
    data: folderConfig.ungroupedDroppable?.data ?? { type: "folder", folderId: null },
    disabled: folderConfig.ungroupedDroppable?.disabled,
  });

  return (
    <div ref={setNodeRef} className={isOver ? "bg-accent/30" : undefined}>
      {showHeader && (
        <ResourceListSectionHeader
          label={folderConfig?.ungroupedLabel ?? "Ungrouped"}
          count={items.length}
          hasRows={items.length > 0}
        />
      )}
      {items.length > 0 && (
        <SortableContext
          items={items.map(itemConfig.getItemSortableId)}
          strategy={verticalListSortingStrategy}
        >
          <ResourceListTable columns={columns} bodyClassName="[&_tr:last-child]:border-b-0">
            {items.map((item) => (
              <ResourceListItemRow
                key={itemConfig.getItemId(item)}
                item={item}
                depth={0}
                columns={columns}
                config={itemConfig}
              />
            ))}
          </ResourceListTable>
        </SortableContext>
      )}
    </div>
  );
}
