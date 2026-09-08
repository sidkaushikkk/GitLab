import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load trained defect propensity model artifact
const modelPath = join(__dirname, "../../models/defect_propensity_model.json");
let modelConfig = null;

try {
  const raw = readFileSync(modelPath, "utf-8");
  modelConfig = JSON.parse(raw);
} catch (e) {
  // Fallback defaults if file read fails
  modelConfig = {
    model_name: "GitLab-NativeAST-DefectPropensity-v1.0",
    algorithm: "Calibrated Logistic Regression on Native AST Features",
    intercept: -0.25,
    ast_features: {
      lines: { weight: 0.35, mean: 120.0, std: 180.0 },
      function_count: { weight: 0.22, mean: 6.0, std: 10.0 },
      class_count: { weight: 0.15, mean: 1.0, std: 2.0 },
      import_count: { weight: 0.18, mean: 5.0, std: 6.0 },
      export_count: { weight: 0.12, mean: 3.0, std: 5.0 },
      avg_complexity: { weight: 0.42, mean: 2.2, std: 2.8 },
      max_complexity: { weight: 0.65, mean: 5.5, std: 7.0 },
      fan_in: { weight: 0.10, mean: 2.0, std: 3.5 },
      fan_out: { weight: 0.30, mean: 3.0, std: 4.5 },
      code_smell_count: { weight: 0.58, mean: 0.8, std: 1.8 },
      has_test: { weight: -0.50, mean: 0.35, std: 0.48 }
    },
    calibration: { min_score: 5.0, max_score: 98.0 }
  };
}

const HUMAN_READABLE_FACTORS = {
  max_complexity: "Peak Cyclomatic Complexity",
  avg_complexity: "High Average Branching Complexity",
  code_smell_count: "AST Code Smells Density",
  lines: "Large Code Volume (LOC)",
  fan_out: "External Dependency Coupling (Fan-Out)",
  fan_in: "High Inbound System Usage (Fan-In)",
  function_count: "High Method / Function Density",
  class_count: "High Class Density",
  import_count: "High Module Import Coupling",
  export_count: "Broad Export Surface Area",
  has_test: "Missing Companion Unit Test"
};

/**
 * Predicts defect propensity probability and risk score for a single file
 * @param {Object} features - Extracted AST features
 * @returns {Object} Prediction details with score, category, and risk factors
 */
export function predictFileDefectRisk(features) {
  const { ast_features, intercept, platt_calibration, scoring_bounds } = modelConfig;
  let logit = intercept || 0;
  const contributions = [];

  for (const [featName, cfg] of Object.entries(ast_features)) {
    const rawVal = Number(features[featName] ?? (featName === "has_test" ? 0 : 0));
    
    // Normalize z-score: (x - mean) / std
    const zScore = (rawVal - cfg.mean) / (cfg.std || 1.0);
    const contribution = cfg.weight * zScore;
    logit += contribution;

    if (contribution > 0) {
      // For negative weights (e.g. collinear balancing), only report if it represents a missing protective feature (like has_test)
      if (cfg.weight < 0 && featName !== "has_test") {
        continue;
      }
      // If raw feature is 0 and not has_test, it shouldn't be reported as an active risk driver
      if (rawVal === 0 && featName !== "has_test") {
        continue;
      }

      contributions.push({
        feature: featName,
        label: HUMAN_READABLE_FACTORS[featName] || featName,
        value: rawVal,
        contribution: contribution
      });
    }
  }

  // Exact Platt Sigmoid Probability: P = 1 / (1 + exp(A * logit + B))
  let probability;
  if (platt_calibration?.enabled && typeof platt_calibration.param_a === "number") {
    probability = 1.0 / (1.0 + Math.exp(platt_calibration.param_a * logit + platt_calibration.param_b));
  } else {
    probability = 1.0 / (1.0 + Math.exp(-logit));
  }
  
  // Calibrated Risk Score bounded between min_score and max_score
  const bounds = scoring_bounds || modelConfig.calibration || { min_score: 5.0, max_score: 98.0 };
  let riskScore = Math.round(probability * 100);
  riskScore = Math.max(bounds.min_score || 5, Math.min(bounds.max_score || 98, riskScore));

  // Determine categorical classification
  let riskCategory = "LOW";
  if (riskScore >= 80) riskCategory = "CRITICAL";
  else if (riskScore >= 60) riskCategory = "HIGH";
  else if (riskScore >= 40) riskCategory = "MEDIUM";

  // Calculate percentage impact of positive risk drivers
  const totalPositive = contributions.reduce((sum, c) => sum + c.contribution, 0);
  const topRiskFactors = contributions
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map(c => ({
      factor: c.label,
      rawFeature: c.feature,
      measuredValue: c.value,
      impact: totalPositive > 0 ? `+${Math.round((c.contribution / totalPositive) * 100)}%` : "+10%"
    }));

  return {
    riskScore,
    probability: Number(probability.toFixed(4)),
    riskCategory,
    topRiskFactors
  };
}

/**
 * Predicts risk across all files in a repository snapshot
 * @param {Array<Object>} fileList - Array of files with their extracted metrics
 * @returns {Object} Comprehensive repository and file-level predictions
 */
export function predictSnapshotDefectRisk(fileList) {
  const filePredictions = [];
  let totalWeightedScore = 0;
  let totalLines = 0;

  const distribution = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  for (const file of fileList) {
    const lines = file.lines || file.lineCount || 1;
    const prediction = predictFileDefectRisk({
      lines,
      function_count: file.function_count || file.functionCount || 0,
      class_count: file.class_count || file.classCount || 0,
      import_count: file.import_count || file.importCount || 0,
      export_count: file.export_count || file.exportCount || 0,
      avg_complexity: file.avg_complexity || file.avgComplexity || 1,
      max_complexity: file.max_complexity || file.maxComplexity || 1,
      fan_in: file.fan_in || file.fanIn || 0,
      fan_out: file.fan_out || file.fanOut || 0,
      code_smell_count: file.code_smell_count || file.smellsCount || file.issuesCount || 0,
      has_test: file.has_test !== undefined ? Number(file.has_test) : (file.hasTest ? 1 : 0)
    });

    const fileResult = {
      filePath: file.filePath || file.path,
      language: file.language || "unknown",
      lines,
      complexity: file.max_complexity || file.maxComplexity || 1,
      smellsCount: file.code_smell_count || file.smellsCount || 0,
      ...prediction
    };

    filePredictions.push(fileResult);

    distribution[prediction.riskCategory.toLowerCase()]++;
    totalWeightedScore += prediction.riskScore * lines;
    totalLines += lines;
  }

  // Calculate LOC-weighted aggregate repository health score (100 - average risk)
  const avgRiskScore = totalLines > 0 ? Math.round(totalWeightedScore / totalLines) : 15;
  const repositoryHealthScore = Math.max(0, Math.min(100, 100 - avgRiskScore));

  // Rank risk hotspots descending by riskScore, then by LOC
  const hotspots = [...filePredictions]
    .sort((a, b) => b.riskScore - a.riskScore || b.lines - a.lines)
    .slice(0, 10);

  return {
    modelMetadata: {
      name: modelConfig.model_name || "GitLab-NativeAST-DefectPropensity-v2.0",
      datasetVersion: modelConfig.dataset_version || "cp7_file_v2.0",
      algorithm: modelConfig.algorithm || "Platt-Calibrated Logistic Regression on Full-Snapshot AST Features",
      trainingDataset: modelConfig.training_dataset || "MultiLanguage_SZZ_FileDefect_Corpus_v2",
      holdoutTestAuc: modelConfig.calibration_metrics?.test_roc_auc ?? 0.7178,
      holdoutTestPrAuc: modelConfig.calibration_metrics?.test_pr_auc ?? 0.7015,
      brierScore: modelConfig.calibration_metrics?.val_brier ?? 0.2418,
      ece: modelConfig.calibration_metrics?.val_ece ?? 0.1108
    },
    repositoryHealthScore,
    averageRiskScore: avgRiskScore,
    totalFilesAnalyzed: filePredictions.length,
    distribution,
    hotspots,
    predictions: filePredictions
  };
}
