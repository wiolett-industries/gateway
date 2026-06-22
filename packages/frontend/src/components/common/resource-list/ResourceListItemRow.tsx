import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ResourceListCell,
  type ResourceListColumn,
  ResourceListRow,
} from "@/components/common/ResourceListLayout";
import type { ResourceListItemConfig } from "./types";

interface ResourceListItemRowProps<TItem> {
  item: TItem;
  depth: number;
  columns: ResourceListColumn<TItem>[];
  config: ResourceListItemConfig<TItem>;
  isOverlay?: boolean;
}

export function ResourceListItemRow<TItem>({
  item,
  depth,
  columns,
  config,
  isOverlay,
}: ResourceListItemRowProps<TItem>) {
  const disabled = isOverlay || (config.isItemDragDisabled?.(item) ?? false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: config.getItemSortableId(item),
    data: { item, ...config.getItemSortableData(item) },
    disabled,
  });
  const canView = config.canViewItem?.(item) ?? !!config.onItemClick;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : "none",
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <ResourceListRow
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      isOverlay={isOverlay}
      interactive={canView}
      onClick={() => {
        if (!isDragging && canView) config.onItemClick?.(item);
      }}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
    >
      {columns.map((column, index) => (
        <ResourceListCell
          key={column.id}
          align={column.align}
          className={column.cellClassName}
          contentClassName={column.cellContentClassName}
          depth={index === 0 ? depth : undefined}
        >
          {column.renderCell?.(item)}
        </ResourceListCell>
      ))}
    </ResourceListRow>
  );
}
