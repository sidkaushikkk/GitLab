-- Migration: 011_alerting_notifications.sql
-- Description: Create tables for Alerting, Notifications & Team Collaboration (Checkpoint 13)

-- 1. Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    rule_id VARCHAR(64) NOT NULL,
    category VARCHAR(64) NOT NULL, -- 'SECURITY', 'PR_RISK', 'CODE_HEALTH', 'API_RELIABILITY', 'DEPENDENCY'
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_type VARCHAR(64) NOT NULL, -- 'snapshot_vulnerability', 'pull_request', 'snapshot_finding', 'snapshot_duplication', 'api_finding', 'defect_risk'
    source_id TEXT NOT NULL,
    snapshot_id UUID REFERENCES repository_snapshots(id) ON DELETE SET NULL,
    pull_request_id UUID REFERENCES pull_requests(id) ON DELETE SET NULL,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    deduplication_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_alert_dedup UNIQUE (repository_id, deduplication_key)
);

CREATE INDEX IF NOT EXISTS idx_alerts_repo_status ON alerts(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON alerts(category);
CREATE INDEX IF NOT EXISTS idx_alerts_assigned ON alerts(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_dedup ON alerts(repository_id, deduplication_key);

-- 2. Alert Activities (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS alert_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- 'CREATED', 'ACKNOWLEDGED', 'ASSIGNED', 'REASSIGNED', 'RESOLVED', 'DISMISSED', 'REOPENED', 'COMMENTED'
    note TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_activities_alert ON alert_activities(alert_id, created_at ASC);

-- 3. Alert Comments
CREATE TABLE IF NOT EXISTS alert_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_comments_alert ON alert_comments(alert_id, created_at ASC);

-- 4. In-App and External Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL DEFAULT 'in_app', -- 'in_app', 'email', 'webhook'
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    status VARCHAR(20) NOT NULL DEFAULT 'DELIVERED' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED')),
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ DEFAULT NOW(),
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_alert ON notifications(alert_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- 5. User Notification Preferences Table
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN NOT NULL DEFAULT false,
    in_app_enabled BOOLEAN NOT NULL DEFAULT true,
    security_alerts BOOLEAN NOT NULL DEFAULT true,
    pr_risk_alerts BOOLEAN NOT NULL DEFAULT true,
    code_health_alerts BOOLEAN NOT NULL DEFAULT true,
    api_reliability_alerts BOOLEAN NOT NULL DEFAULT true,
    dependency_alerts BOOLEAN NOT NULL DEFAULT true,
    min_severity VARCHAR(20) NOT NULL DEFAULT 'LOW' CHECK (min_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
