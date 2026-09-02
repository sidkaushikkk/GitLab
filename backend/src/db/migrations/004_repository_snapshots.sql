-- Migration: 004_repository_snapshots.sql
-- Description: Create repository_snapshots table for storing normalized repository snapshot metadata

CREATE TABLE IF NOT EXISTS repository_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    branch VARCHAR(100) NOT NULL DEFAULT 'main',
    status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    total_files INTEGER NOT NULL DEFAULT 0,
    included_files INTEGER NOT NULL DEFAULT 0,
    skipped_files INTEGER NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    storage_key TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_snapshots_repo_commit ON repository_snapshots(repository_id, commit_sha);
CREATE INDEX IF NOT EXISTS idx_snapshots_repository_id ON repository_snapshots(repository_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_status ON repository_snapshots(status);
