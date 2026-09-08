-- Migration: 006_pull_requests.sql
-- Description: Create tables for Pull Request risk engine, diff analysis, and AST blast radius tracking

-- 1. Pull Requests Table
CREATE TABLE IF NOT EXISTS pull_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    author VARCHAR(100),
    source_branch VARCHAR(255) NOT NULL,
    target_branch VARCHAR(255) NOT NULL,
    source_commit_sha VARCHAR(40) NOT NULL,
    target_commit_sha VARCHAR(40) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'merged')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pull_requests_repo_number UNIQUE (repository_id, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_id ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_number ON pull_requests(repository_id, pr_number);
CREATE INDEX IF NOT EXISTS idx_pull_requests_status ON pull_requests(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_head_sha ON pull_requests(source_commit_sha);

-- 2. Pull Request Analyses Table
CREATE TABLE IF NOT EXISTS pull_request_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pull_request_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    base_snapshot_id UUID REFERENCES repository_snapshots(id) ON DELETE SET NULL,
    commit_sha VARCHAR(40),
    status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    analysis_version VARCHAR(50) NOT NULL DEFAULT '1.0',
    risk_score DOUBLE PRECISION,
    risk_category VARCHAR(50),
    quality_gate VARCHAR(50),
    churn_metrics JSONB DEFAULT '{}'::jsonb,
    blast_radius JSONB DEFAULT '{}'::jsonb,
    findings JSONB DEFAULT '[]'::jsonb,
    summary TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pr_analyses_pr_id ON pull_request_analyses(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_pr_analyses_status ON pull_request_analyses(status);

-- 3. Pull Request Diffs Table
CREATE TABLE IF NOT EXISTS pull_request_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pull_request_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    analysis_id UUID REFERENCES pull_request_analyses(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    old_path TEXT,
    change_type VARCHAR(50) NOT NULL CHECK (change_type IN ('added', 'modified', 'deleted', 'renamed', 'copied', 'unchanged')),
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    changed_line_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
    patch TEXT,
    touched_symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_diffs_pr_id ON pull_request_diffs(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_pr_diffs_analysis_id ON pull_request_diffs(analysis_id);
CREATE INDEX IF NOT EXISTS idx_pr_diffs_file_path ON pull_request_diffs(pull_request_id, file_path);
