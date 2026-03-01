// src/app/ui/flat-tree/flat-tree.helper.ts

export interface FlatTreeNode {
  id: string;
  name: string;
  type: 'Folder' | 'Document';
  parentId: string | null;
  level: number;
  expandable: boolean;
  isExpanded: boolean;
  originalData: any;
}

export function buildFlatTree(
  items: any[],
  expandedIds: Set<string>,
  typeField: string = 'type',
): FlatTreeNode[] {
  // Build a set of IDs that have at least one child
  const parentIdsWithChildren = new Set<string | null>();
  for (const item of items) {
    parentIdsWithChildren.add(item.parentId ?? null);
  }

  // 1. Convert raw items to lightweight nodes
  const nodes = items.map((item) => {
    // Determine type safely
    const nodeType = item[typeField] || 'Folder';
    // Normalize: treat undefined as null for root-level items
    const normalizedParentId = item.parentId ?? null;
    // Only Folders that actually have children are expandable
    const isExpandable = nodeType === 'Folder' && parentIdsWithChildren.has(item.id);

    return {
      id: item.id,
      name: item.name,
      type: nodeType,
      parentId: normalizedParentId,
      level: 0,
      expandable: isExpandable,
      isExpanded: isExpandable && expandedIds.has(item.id),
      originalData: item,
    };
  });

  const result: FlatTreeNode[] = [];

  // 2. Recursive function to walk the tree in order
  function process(parentId: string | null, level: number, visible: boolean) {
    const children = nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => {
        // Sort: Folders first, then Alphabetical
        if (a.type !== b.type) return a.type === 'Folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const child of children) {
      child.level = level;

      if (visible) {
        result.push(child);
      }

      // If this node is visible AND expanded, its children are visible
      const childrenVisible = visible && child.isExpanded;
      process(child.id, level + 1, childrenVisible);
    }
  }

  process(null, 0, true);

  return result;
}
