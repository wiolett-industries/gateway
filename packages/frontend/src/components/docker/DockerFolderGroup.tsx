import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Lock,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { InlineFolderEditor } from "@/components/proxy/InlineFolderEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DockerFolderTreeNode } from "@/types";
import { DockerContainerRow, type DockerContainerRowData } from "./DockerContainerRow";

export interface DockerFolderTreeNodeWithContainers extends DockerFolderTreeNode {
  containers: DockerContainerRowData[];
  children: DockerFolderTreeNodeWithContainers[];
}

interface DockerFolderGroupProps {
  folder: DockerFolderTreeNodeWithContainers;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRequestCreateSubfolder: (parentId: string) => void;
  onStart: (container: DockerContainerRowData) => void;
  onStop: (container: DockerContainerRowData) => void;
  onRestart: (container: DockerContainerRowData) => void;
  actionLoading: Record<string, string>;
  onMoveContainerToFolder: (container: DockerContainerRowData) => void;
  expandedFolderIds: Set<string>;
  onToggleFolder: (id: string) => void;
  canManage: (container: DockerContainerRowData) => boolean;
  canReorganize: (container: DockerContainerRowData) => boolean;
  canView: (container: DockerContainerRowData) => boolean;
  canManageFolders: boolean;
  canReorder?: boolean;
  collapsible?: boolean;
  showNode: boolean;
  colGroup: React.ReactNode;
}

function countAllContainers(folder: DockerFolderTreeNodeWithContainers): number {
  let count = folder.containers.length;
  for (const child of folder.children) count += countAllContainers(child);
  return count;
}

export function DockerFolderGroup({
  folder,
  depth,
  expanded,
  onToggle,
  onRename,
  onDelete,
  onRequestCreateSubfolder,
  onStart,
  onStop,
  onRestart,
  actionLoading,
  onMoveContainerToFolder,
  expandedFolderIds,
  onToggleFolder,
  canManage,
  canReorganize,
  canView,
  canManageFolders,
  canReorder = canManageFolders,
  collapsible = true,
  showNode,
  colGroup,
}: DockerFolderGroupProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: `docker-folder-${folder.id}`,
    data: { type: "folder", folderId: folder.id, isSystem: folder.isSystem, folder },
    disabled: !canReorder,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : "none",
    opacity: isDragging ? 0.3 : 1,
  };
  const totalContainers = countAllContainers(folder);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`flex min-h-[53px] items-center gap-2 px-3 py-2 transition-colors border-b border-border ${
          collapsible ? "cursor-pointer hover:bg-accent" : ""
        }`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={collapsible ? onToggle : undefined}
        {...(canReorder ? attributes : {})}
        {...(canReorder ? listeners : {})}
      >
        {collapsible ? (
          <button type="button" className="text-muted-foreground shrink-0">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-40" />
        )}
        <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
        {folder.isSystem && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}

        {isRenaming ? (
          <div onClick={(e) => e.stopPropagation()}>
            <InlineFolderEditor
              initialName={folder.name}
              onSave={(name) => {
                onRename(folder.id, name);
                setIsRenaming(false);
              }}
              onCancel={() => setIsRenaming(false)}
            />
          </div>
        ) : (
          <span className="text-sm font-medium">{folder.name}</span>
        )}

        <Badge variant="secondary" className="text-xs ml-1">
          {totalContainers}
        </Badge>

        {folder.isSystem && folder.composeProject && (
          <Badge variant="outline" className="text-xs">
            COMPOSE
          </Badge>
        )}

        {canManageFolders && !folder.isSystem && !isRenaming && (
          <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                  <Pencil className="h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                {folder.depth < 2 && (
                  <DropdownMenuItem onClick={() => onRequestCreateSubfolder(folder.id)}>
                    <FolderPlus className="h-4 w-4" />
                    Add subfolder
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(folder.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <motion.div
        initial={false}
        animate={{
          height: expanded ? "auto" : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="overflow-hidden"
        aria-hidden={!expanded}
      >
        {folder.children.length > 0 && (
          <SortableContext
            items={folder.children.map((child) => `docker-folder-${child.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {folder.children.map((child) => (
              <DockerFolderGroup
                key={child.id}
                folder={child}
                depth={depth + 1}
                expanded={collapsible ? expandedFolderIds.has(child.id) : true}
                onToggle={() => onToggleFolder(child.id)}
                onRename={onRename}
                onDelete={onDelete}
                onRequestCreateSubfolder={onRequestCreateSubfolder}
                onStart={onStart}
                onStop={onStop}
                onRestart={onRestart}
                actionLoading={actionLoading}
                onMoveContainerToFolder={onMoveContainerToFolder}
                expandedFolderIds={expandedFolderIds}
                onToggleFolder={onToggleFolder}
                canManage={canManage}
                canReorganize={canReorganize}
                canView={canView}
                canManageFolders={canManageFolders}
                canReorder={canReorder}
                collapsible={collapsible}
                showNode={showNode}
                colGroup={colGroup}
              />
            ))}
          </SortableContext>
        )}

        {folder.containers.length > 0 &&
          (folder.isSystem ? (
            <table className="w-full" style={{ tableLayout: "fixed" }}>
              {colGroup}
              <tbody>
                {folder.containers.map((container) => (
                  <DockerContainerRow
                    key={`${container._nodeId}:${container.name}`}
                    container={container}
                    depth={depth + 1}
                    canView={canView(container)}
                    canManage={canManage(container)}
                    canReorganize={canReorganize(container)}
                    showNode={showNode}
                    loadingAction={actionLoading[container.id]}
                    onStart={onStart}
                    onStop={onStop}
                    onRestart={onRestart}
                    onMoveToFolder={onMoveContainerToFolder}
                    canDrag={canReorder && canReorganize(container)}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <SortableContext
              items={folder.containers.map((container) => `${container._nodeId}:${container.name}`)}
              strategy={verticalListSortingStrategy}
            >
              <table className="w-full" style={{ tableLayout: "fixed" }}>
                {colGroup}
                <tbody>
                  {folder.containers.map((container) => (
                    <DockerContainerRow
                      key={`${container._nodeId}:${container.name}`}
                      container={container}
                      depth={depth + 1}
                      canView={canView(container)}
                      canManage={canManage(container)}
                      canReorganize={canReorganize(container)}
                      showNode={showNode}
                      loadingAction={actionLoading[container.id]}
                      onStart={onStart}
                      onStop={onStop}
                      onRestart={onRestart}
                      onMoveToFolder={onMoveContainerToFolder}
                      canDrag={canReorder && canReorganize(container)}
                    />
                  ))}
                </tbody>
              </table>
            </SortableContext>
          ))}
      </motion.div>
    </div>
  );
}
