export interface TreeNode {
  id: string;
  name: string;
  // 'type' is optional. If missing, we assume it's a Folder (like Collection).
  type?: 'Folder' | 'Document';
  children: TreeNode[];
  // Allow the original DTO to be attached if needed, or index signature
  [key: string]: any;
}

export interface TreeNodeMoveEvent {
  item: TreeNode;
  newParentId: string | null;
}
