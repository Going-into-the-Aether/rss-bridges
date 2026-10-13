export interface BuildInfo {
  schema_version: 1;
  source_commit: string | null;
  source_dirty: boolean | null;
  built_at: string | null;
  build_id: string | null;
  release_version: string | null;
}

// Tests without a Wrangler build have no measured source identity.
export const buildInfo: BuildInfo = {
  schema_version: 1,
  source_commit: null,
  source_dirty: null,
  built_at: null,
  build_id: null,
  release_version: null,
};
