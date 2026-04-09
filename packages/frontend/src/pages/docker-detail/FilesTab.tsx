import {
  ChevronDown,
  ChevronRight,
  File,
  FileSymlink,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { FileEntry } from "@/types";
import { formatBytes } from "./helpers";

// ── Types ────────────────────────────────────────────────────────

interface TreeNode extends FileEntry {
  path: string;
  children: TreeNode[] | null; // null = not loaded, [] = empty dir (or non-dir)
  expanded: boolean;
  loading: boolean;
}

// ── Component ────────────────────────────────────────────────────

export function FilesTab({ nodeId, containerId }: { nodeId: string; containerId: string }) {
  const { hasScope } = useAuthStore();
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const nodeIdRef = useRef(nodeId);
  const containerIdRef = useRef(containerId);
  nodeIdRef.current = nodeId;
  containerIdRef.current = containerId;

  const fetchDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const data: FileEntry[] = await api.listContainerDir(
      nodeIdRef.current,
      containerIdRef.current,
      dirPath
    );
    return (data ?? []).map((entry) => ({
      ...entry,
      path: dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`,
      children: entry.isDir ? null : [],
      expanded: false,
      loading: false,
    }));
  }, []);

  // Load root on mount
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchDir("/")
      .then((nodes) => {
        if (!cancelled) {
          setRoots(nodes);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDir]);

  // Toggle a directory open/closed
  const toggleDir = useCallback(
    async (path: string) => {
      const updateNodes = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((node) => {
          if (node.path === path) {
            if (node.expanded) {
              // Collapse
              return { ...node, expanded: false };
            }
            // Expand — load children if needed
            if (node.children === null) {
              return { ...node, loading: true, expanded: true };
            }
            return { ...node, expanded: true };
          }
          if (node.children && node.expanded) {
            return { ...node, children: updateNodes(node.children) };
          }
          return node;
        });

      setRoots((prev) => updateNodes(prev));

      // Find the node to check if it needs loading
      const findNode = (nodes: TreeNode[]): TreeNode | null => {
        for (const n of nodes) {
          if (n.path === path) return n;
          if (n.children && n.expanded) {
            const found = findNode(n.children);
            if (found) return found;
          }
        }
        return null;
      };

      // We need to check current state — use a callback pattern
      setRoots((prev) => {
        const node = findNode(prev);
        if (node && node.loading) {
          // Fetch in background, then update
          fetchDir(path)
            .then((children) => {
              const setChildren = (nodes: TreeNode[]): TreeNode[] =>
                nodes.map((n) => {
                  if (n.path === path) {
                    return { ...n, children, loading: false };
                  }
                  if (n.children && n.expanded) {
                    return { ...n, children: setChildren(n.children) };
                  }
                  return n;
                });
              setRoots((curr) => setChildren(curr));
            })
            .catch(() => {
              const setError = (nodes: TreeNode[]): TreeNode[] =>
                nodes.map((n) => {
                  if (n.path === path) {
                    return { ...n, children: [], loading: false, expanded: false };
                  }
                  if (n.children && n.expanded) {
                    return { ...n, children: setError(n.children) };
                  }
                  return n;
                });
              setRoots((curr) => setError(curr));
              toast.error("Failed to list directory");
            });
        }
        return prev; // no mutation here, async handles it
      });
    },
    [fetchDir]
  );

  // Open file in a separate window
  const openFile = useCallback(
    (filePath: string, writable?: boolean) => {
      const params = new URLSearchParams({ path: filePath });
      if (writable) params.set("writable", "1");
      const url = `/docker/file/${nodeId}/${containerId}?${params}`;
      const fileName = filePath.split("/").pop() || "file";
      window.open(
        url,
        `file-${containerId}-${fileName}`,
        "width=900,height=600,menubar=no,toolbar=no"
      );
    },
    [nodeId, containerId]
  );

  if (!hasScope("docker:containers:files")) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        You don't have permission to browse files.
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="border border-border bg-card">
        <div className="overflow-x-auto -mb-px">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="p-3 text-xs font-medium text-muted-foreground">Name</th>
                <th className="p-3 text-xs font-medium text-muted-foreground w-24 text-right">
                  Size
                </th>
                <th className="p-3 text-xs font-medium text-muted-foreground w-44">
                  Last Modified
                </th>
                <th className="p-3 text-xs font-medium text-muted-foreground w-28">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && roots.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground text-sm">
                    Empty directory
                  </td>
                </tr>
              )}
              {!isLoading &&
                roots.map((node) => (
                  <TreeRow
                    key={node.path}
                    node={node}
                    depth={0}
                    onToggle={toggleDir}
                    onOpenFile={openFile}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tree Row (recursive) ─────────────────────────────────────────

function TreeRow({
  node,
  depth,
  onToggle,
  onOpenFile,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onOpenFile: (path: string, writable?: boolean) => void;
}) {
  const indent = depth * 20;
  const isNonDirSymlink = node.isSymlink && !node.isDir;
  const isOpenable = !node.isDir && !isNonDirSymlink && !node.isSpecial;

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleClick = () => {
    if (node.isDir) {
      onToggle(node.path);
    } else if (!isOpenable) {
      // blocked — symlink or special file
    } else if (node.size > MAX_FILE_SIZE) {
      toast.error(`File too large to open (${formatBytes(node.size)}, max 10 MB)`);
    } else {
      onOpenFile(node.path, node.isWritable);
    }
  };

  return (
    <>
      <tr
        className={
          !isOpenable && !node.isDir
            ? "transition-colors"
            : "hover:bg-accent transition-colors cursor-pointer"
        }
        onClick={handleClick}
      >
        <td className="p-3 text-sm">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: indent }}>
            {node.isDir ? (
              <>
                {node.loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                ) : node.expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                {node.expanded ? (
                  <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
                ) : (
                  <Folder className="h-4 w-4 text-blue-400 shrink-0" />
                )}
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                {node.isSymlink ? (
                  <FileSymlink className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </>
            )}
            <span className="truncate">{node.name}</span>
            {node.linkTarget && (
              <span className="text-muted-foreground truncate">&rarr; {node.linkTarget}</span>
            )}
          </div>
        </td>
        <td className="p-3 text-sm text-muted-foreground text-right font-mono">
          {node.isDir ? "-" : formatBytes(node.size)}
        </td>
        <td className="p-3 text-sm text-muted-foreground">{node.modified || "-"}</td>
        <td className="p-3 text-sm text-muted-foreground font-mono">{node.permissions || "-"}</td>
      </tr>
      {node.isDir &&
        node.expanded &&
        node.children &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
    </>
  );
}
