-- Migration: 005_code_intelligence.sql
-- Description: Creates/updates tables for AST-based code intelligence, symbols, relationships, metrics, code smells, and ML-ready features

-- 1. Ensure analysis_runs table has CP6 snapshot and metric columns
CREATE TABLE IF NOT EXISTS analysis_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    triggered_by VARCHAR(100) NOT NULL DEFAULT 'manual',
    status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS snapshot_id UUID REFERENCES repository_snapshots(id) ON DELETE CASCADE;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS commit_sha VARCHAR(40);
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS total_files_analyzed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS total_files_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS total_symbols INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS total_relationships INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS total_smells INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_analysis_runs_repo_snapshot ON analysis_runs(repository_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_snapshot_id ON analysis_runs(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_status ON analysis_runs(status);

-- 2. Analysis Files Table
CREATE TABLE IF NOT EXISTS analysis_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    language VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'analyzed' CHECK (status IN ('analyzed', 'parse_failed', 'unsupported')),
    line_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_files_run_id ON analysis_files(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_analysis_files_path ON analysis_files(analysis_run_id, file_path);

-- 3. Symbols Table
CREATE TABLE IF NOT EXISTS symbols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    file_id UUID REFERENCES analysis_files(id) ON DELETE CASCADE,
    parent_symbol_id UUID REFERENCES symbols(id) ON DELETE SET NULL,
    symbol_type VARCHAR(50) NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symbols_run_id ON symbols(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(analysis_run_id, file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(analysis_run_id, symbol_type);

-- 4. Relationships Table
CREATE TABLE IF NOT EXISTS relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    source_symbol_id UUID REFERENCES symbols(id) ON DELETE CASCADE,
    source_file_path TEXT NOT NULL,
    target_symbol_id UUID REFERENCES symbols(id) ON DELETE SET NULL,
    target_file_path TEXT,
    relationship_type VARCHAR(50) NOT NULL,
    symbols_imported TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relationships_run_id ON relationships(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(analysis_run_id, relationship_type);

-- 5. Metrics Table
CREATE TABLE IF NOT EXISTS metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id TEXT NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_run_entity ON metrics(analysis_run_id, entity_type, entity_id);

-- 6. Code Smells Table
CREATE TABLE IF NOT EXISTS code_smells (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    rule_id VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL DEFAULT 'medium',
    file_path TEXT NOT NULL,
    symbol_name TEXT,
    line INTEGER,
    measured_value DOUBLE PRECISION NOT NULL,
    threshold DOUBLE PRECISION NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_smells_run_id ON code_smells(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_code_smells_file ON code_smells(analysis_run_id, file_path);

-- 7. ML-Ready Features Table
CREATE TABLE IF NOT EXISTS features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id TEXT NOT NULL,
    feature_schema_version VARCHAR(20) NOT NULL DEFAULT '1.0',
    feature_name VARCHAR(100) NOT NULL,
    feature_value DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_run_entity ON features(analysis_run_id, entity_type, entity_id);
