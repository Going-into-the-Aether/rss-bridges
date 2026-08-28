export interface FeedItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  modifiedAt: string;
  authors: string[];
  description: string;
  contentHtml: string;
  imageUrl?: string;
  categories: string[];
  sourceType: string;
  usedFallbackAuthor: boolean;
}

export interface SourceDiagnostic {
  ok: boolean;
  endpoint: string;
  pagesFetched: number;
  recordsFetched: number;
  error?: string;
  fallback?: boolean;
  snapshotGeneratedAt?: string;
}

export interface FeedDiagnostic {
  ok: boolean;
  partial: boolean;
  generatedAt: string;
  mode: "bootstrap" | "rolling";
  sources: Record<string, SourceDiagnostic>;
  mergedItems: number;
  authorFallbacks: number;
  newest: Pick<FeedItem, "title" | "url" | "publishedAt" | "authors"> | null;
}

export interface FeedResult {
  items: FeedItem[];
  diagnostic: FeedDiagnostic;
}
