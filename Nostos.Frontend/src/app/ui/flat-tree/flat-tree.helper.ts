// src/app/ui/flat-tree/flat-tree.helper.ts

export interface TreeItem {
  id: string;
  name: string;
  parentId?: string | null;
  type?: 'Folder' | 'Document';
}

export interface FlatTreeNode<T extends TreeItem = TreeItem> {
  id: string;
  name: string;
  type: 'Folder' | 'Document';
  parentId: string | null;
  level: number;
  expandable: boolean;
  isExpanded: boolean;
  originalData: T;
}

export function buildFlatTree<T extends TreeItem>(
  items: T[],
  expandedIds: Set<string>,
  treatAllAsFolders = false,
): FlatTreeNode<T>[] {
  const childrenMap = new Map<string | null, T[]>();
  const parentIdsWithChildren = new Set<string | null>();

  for (const item of items) {
    const pid = item.parentId ?? null;
    parentIdsWithChildren.add(pid);
    let siblings = childrenMap.get(pid);
    if (!siblings) {
      siblings = [];
      childrenMap.set(pid, siblings);
    }
    siblings.push(item);
  }

  const result: FlatTreeNode<T>[] = [];

  function process(parentId: string | null, level: number, visible: boolean) {
    const children = childrenMap.get(parentId);
    if (!children) return;

    children.sort((a, b) => {
      const aType = treatAllAsFolders ? 'Folder' : (a.type ?? 'Folder');
      const bType = treatAllAsFolders ? 'Folder' : (b.type ?? 'Folder');
      if (aType !== bType) return aType === 'Folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of children) {
      const nodeType: 'Folder' | 'Document' = treatAllAsFolders
        ? 'Folder'
        : (child.type ?? 'Folder');
      const isExpandable =
        nodeType === 'Folder' && parentIdsWithChildren.has(child.id);
      const isExpanded = isExpandable && expandedIds.has(child.id);

      if (visible) {
        result.push({
          id: child.id,
          name: child.name,
          type: nodeType,
          parentId: child.parentId ?? null,
          level,
          expandable: isExpandable,
          isExpanded,
          originalData: child,
        });
      }

      process(child.id, level + 1, visible && isExpanded);
    }
  }

  process(null, 0, true);
  return result;
}
