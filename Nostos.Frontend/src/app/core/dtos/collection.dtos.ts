export interface Collection {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface CreateCollectionDto {
  name: string;
  parentId?: string | null;
}

export interface UpdateCollectionDto {
  name: string;
  parentId?: string | null;
}
