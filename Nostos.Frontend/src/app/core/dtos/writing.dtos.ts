export interface WritingDto {
  id: string;
  name: string;
  type: 'Folder' | 'Document';
  parentId?: string | null;
  updatedAt: string;
}

export interface WritingContentDto {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
}

export interface CreateWritingDto {
  name: string;
  type: 'Folder' | 'Document';
  parentId?: string | null;
}

export interface UpdateWritingDto {
  name: string;
  content?: string;
}

export interface MoveWritingDto {
  newParentId?: string | null;
}
