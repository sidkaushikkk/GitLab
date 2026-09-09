-- Migration: 009_longitudinal_duplication.sql
-- Description: Create tables for snapshot-scoped code duplication findings, duplication summaries, and deterministic snapshot ordering metadata (Checkpoint 10)

-- 1. Ensure repository_snapshots has commit_timestamp for deterministic chronological ordering
ALTER TABLE repository_snapshots 
ADD COLUMN IF NOT EXISTS commit_timestamp TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_snapshots_chronological 
ON repository_snapshots (repository_id, COALESCE(commit_timestamp, created_at) ASC, id ASC);

-- 2. Snapshot Duplication Summaries Table (Repository snapshot-level aggregate metrics)
CREATE TABLE IF NOT EXISTS snapshot_duplication_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL UNIQUE REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    total_source_lines INTEGER NOT NULL DEFAULT 0,
    duplicated_lines INTEGER NOT NULL DEFAULT 0,
    duplication_ratio NUMERIC(5, 4) NOT NULL DEFAULT 0.0000,
    clone_count INTEGER NOT NULL DEFAULT 0,
    clone_group_count INTEGER NOT NULL DEFAULT 0,
    intra_file_clones INTEGER NOT NULL DEFAULT 0,
    inter_file_clones INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duplication_summaries_snapshot 
ON snapshot_duplication_summaries(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_duplication_summaries_repo 
ON snapshot_duplication_summaries(repository_id);

-- 3. Detailed Snapshot Duplication Findings Table (Snapshot-scoped clone clusters and occurrences)
CREATE TABLE IF NOT EXISTS snapshot_duplications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    clone_hash VARCHAR(64) NOT NULL,
    clone_type VARCHAR(20) NOT NULL DEFAULT 'TYPE_2', -- 'TYPE_1' (exact) or 'TYPE_2' (parameterized)
    token_count INTEGER NOT NULL,
    line_count INTEGER NOT NULL,
    is_intra_file BOOLEAN NOT NULL DEFAULT false,
    instances JSONB NOT NULL DEFAULT '[]', -- Array of [{ filePath, startLine, endLine, startCol, endCol }]
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_snapshot_clone UNIQUE (snapshot_id, clone_hash)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_duplications_snapshot 
ON snapshot_duplications(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_duplications_repo 
ON snapshot_duplications(repository_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_duplications_hash 
ON snapshot_duplications(clone_hash);
