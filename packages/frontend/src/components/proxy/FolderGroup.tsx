import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FolderTreeNode } from "@/types";
import { InlineFolderEditor } from "./InlineFolderEditor";
import { ProxyHostRow } from "./ProxyHostRow";

interface FolderGroupProps {
  folder: FolderTreeNode;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCreateSubfolder: (parentId: string, name: string) => void;
  onToggleHost: (id: string, currentEnabled: boolean) => void;
  togglingIds: Set<string>;
  onMoveHostToFolder: (hostId: string) => void;
  expandedFolderIds: Set<string>;
  onToggleFolder: (id: string) => void;
  canManage: boolean;
  colGroup: React.ReactNode;
}

function countAllHosts(folder: FolderTreeNode): number {
  let count = folder.hosts.length;
  for (const child of folder.children) {
    count += countAllHosts(child);
  }
  return count;
}

export function FolderGroup({
  folder,
  depth,
  expanded,
  onToggle,
  onRename,
  onDelete,
  onCreateSubfolder,
  onToggleHost,
  togglingIds,
  onMoveHostToFolder,
  expandedFolderIds,
  onToggleFolder,
  canManage,
  colGroup,
}: FolderGroupProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [isCreatingSubfolder, setIsCreatingSubfolder] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${folder.id}`,
    data: { type: "folder", folderId: folder.id },
  });

  const totalHosts = countAllHosts(folder);

  return (
    <div ref={setNodeRef}>
      {/* Folder header */}
      <div
        className={`flex items-center gap-2 py-2 px-3 cursor-pointer hover:bg-accent transition-colors border-b border-border ${
          isOver ? "bg-accent/50" : ""
        }`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={onToggle}
      >
        <button type="button" className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <Folder className="h-4 w-4 text-muted-foreground shrink-0" />

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
          {totalHosts}
        </Badge>

        {canManage && !isRenaming && (
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
                  <DropdownMenuItem onClick={() => setIsCreatingSubfolder(true)}>
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

      {/* Inline subfolder creation */}
      {isCreatingSubfolder && (
        <div
          className="py-2 px-3 border-b border-border"
          style={{ paddingLeft: `${(depth + 1) * 24 + 12}px` }}
        >
          <InlineFolderEditor
            onSave={(name) => {
              onCreateSubfolder(folder.id, name);
              setIsCreatingSubfolder(false);
            }}
            onCancel={() => setIsCreatingSubfolder(false)}
          />
        </div>
      )}

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            {/* Child folders */}
            {folder.children.map((child) => (
              <FolderGroup
                key={child.id}
                folder={child}
                depth={depth + 1}
                expanded={expandedFolderIds.has(child.id)}
                onToggle={() => onToggleFolder(child.id)}
                onRename={onRename}
                onDelete={onDelete}
                onCreateSubfolder={onCreateSubfolder}
                onToggleHost={onToggleHost}
                togglingIds={togglingIds}
                onMoveHostToFolder={onMoveHostToFolder}
                expandedFolderIds={expandedFolderIds}
                onToggleFolder={onToggleFolder}
                canManage={canManage}
                colGroup={colGroup}
              />
            ))}

            {/* Hosts in this folder */}
            {folder.hosts.length > 0 && (
              <SortableContext
                items={folder.hosts.map((h) => h.id)}
                strategy={verticalListSortingStrategy}
              >
                <table className="w-full" style={{ tableLayout: "fixed" }}>
                  {colGroup}
                  <tbody>
                    {folder.hosts.map((host) => (
                      <ProxyHostRow
                        key={host.id}
                        host={host}
                        depth={depth + 1}
                        onToggle={onToggleHost}
                        togglingIds={togglingIds}
                        onMoveToFolder={onMoveHostToFolder}
                      />
                    ))}
                  </tbody>
                </table>
              </SortableContext>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
