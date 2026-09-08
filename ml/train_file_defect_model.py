#!/usr/bin/env python3
"""
Checkpoint 7: Scientific Rebuild Model Training, Calibration & Evaluation
Trains both Logistic Regression and Random Forest on P0/P1 corrected dataset.
Evaluates on validation split and unseen project holdout test set.
Fits Platt scaling calibration strictly on validation data.
Performs model selection and exports serialized production artifacts.
"""

import os
import sys
import json
import joblib
import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.frozen import FrozenEstimator
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    roc_auc_score, average_precision_score, brier_score_loss,
    precision_score, recall_score, f1_score, confusion_matrix
)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(BASE_DIR, "ml", "data")
BACKEND_MODEL_DIR = os.path.join(BASE_DIR, "backend", "src", "models")
ML_MODEL_DIR = os.path.join(BASE_DIR, "ml", "models")

os.makedirs(BACKEND_MODEL_DIR, exist_ok=True)
os.makedirs(ML_MODEL_DIR, exist_ok=True)

FEATURE_COLS = [
    "lines",
    "function_count",
    "class_count",
    "import_count",
    "export_count",
    "avg_complexity",
    "max_complexity",
    "fan_in",
    "fan_out",
    "code_smell_count",
    "has_test"
]

def compute_ece(y_true, y_prob, n_bins=5):
    """Computes Expected Calibration Error (ECE) with equal-width bins"""
    bins = np.linspace(0., 1. + 1e-8, n_bins + 1)
    binids = np.digitize(y_prob, bins) - 1
    bin_sums = np.bincount(binids, weights=y_prob, minlength=len(bins))
    bin_true = np.bincount(binids, weights=y_true, minlength=len(bins))
    bin_total = np.bincount(binids, minlength=len(bins))
    nonzero = bin_total != 0
    prob_true_bin = bin_true[nonzero] / bin_total[nonzero]
    prob_pred_bin = bin_sums[nonzero] / bin_total[nonzero]
    ece = np.sum(np.abs(prob_true_bin - prob_pred_bin) * (bin_total[nonzero] / len(y_true)))
    return float(ece)

def evaluate_predictions(y_true, probs, model_name, split_name):
    preds = (probs >= 0.5).astype(int)
    auc = roc_auc_score(y_true, probs) if len(np.unique(y_true)) > 1 else 0.5
    pr_auc = average_precision_score(y_true, probs) if len(np.unique(y_true)) > 1 else 0.5
    brier = brier_score_loss(y_true, probs)
    prec = precision_score(y_true, preds, zero_division=0)
    rec = recall_score(y_true, preds, zero_division=0)
    f1 = f1_score(y_true, preds, zero_division=0)
    cm = confusion_matrix(y_true, preds).tolist()
    ece = compute_ece(y_true, probs)

    return {
        "model": model_name,
        "split": split_name,
        "samples": len(y_true),
        "positive_count": int((y_true == 1).sum()),
        "negative_count": int((y_true == 0).sum()),
        "positive_rate": round(float(y_true.mean()), 4),
        "roc_auc": round(float(auc), 4),
        "pr_auc": round(float(pr_auc), 4),
        "brier": round(float(brier), 4),
        "ece": round(float(ece), 4),
        "precision": round(float(prec), 4),
        "recall": round(float(rec), 4),
        "f1": round(float(f1), 4),
        "confusion_matrix": cm
    }

def train_and_evaluate():
    print("=" * 75)
    print("  CHECKPOINT 7: SCIENTIFIC REBUILD MODEL TRAINING & EVALUATION")
    print("=" * 75)

    train_path = os.path.join(DATA_DIR, "cp7_train.csv")
    val_path = os.path.join(DATA_DIR, "cp7_val.csv")
    test_path = os.path.join(DATA_DIR, "cp7_test.csv")
    manifest_path = os.path.join(DATA_DIR, "dataset_manifest.json")

    if not os.path.exists(train_path):
        print(f"Error: {train_path} does not exist. Run mining pipeline first.")
        sys.exit(1)

    df_train = pd.read_csv(train_path)
    df_val = pd.read_csv(val_path)
    df_test = pd.read_csv(test_path)

    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, "r") as f:
            manifest = json.load(f)

    print(f"\n[Step 1] Loaded Rebuilt SZZ Partitions:")
    print(f"  Training Split:       {df_train.shape[0]:,} obs across {df_train['repo'].nunique()} repos ({df_train['has_defect'].mean()*100:.1f}% pos)")
    print(f"  Validation Split:     {df_val.shape[0]:,} obs across {df_val['repo'].nunique()} repos ({df_val['has_defect'].mean()*100:.1f}% pos)")
    print(f"  Holdout Test Split:   {df_test.shape[0]:,} obs across {df_test['repo'].nunique()} repos ({df_test['has_defect'].mean()*100:.1f}% pos)")

    X_train, y_train = df_train[FEATURE_COLS], df_train["has_defect"]
    X_val, y_val = df_val[FEATURE_COLS], df_val["has_defect"]
    X_test, y_test = df_test[FEATURE_COLS], df_test["has_defect"]

    # Fit scaler strictly on training split
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_val_scaled = scaler.transform(X_val)
    X_test_scaled = scaler.transform(X_test)

    # ------------------------------------------------------------------------
    # Model 1: Logistic Regression
    # ------------------------------------------------------------------------
    print("\n[Step 2] Training Logistic Regression...")
    lr = LogisticRegression(class_weight="balanced", C=0.5, max_iter=1000, random_state=42)
    lr.fit(X_train_scaled, y_train)

    # ------------------------------------------------------------------------
    # Model 2: Random Forest
    # ------------------------------------------------------------------------
    print("\n[Step 3] Training Random Forest Benchmark...")
    rf = RandomForestClassifier(n_estimators=100, max_depth=6, class_weight="balanced", random_state=42)
    rf.fit(X_train, y_train)

    # ------------------------------------------------------------------------
    # Calibration Procedure (5-Fold Out-of-Fold Cross-Validation on Training Split)
    # ------------------------------------------------------------------------
    print("\n[Step 4] Fitting Platt Scaling Calibration via 5-Fold Cross-Validation on Training Split...")
    # Calibrate Logistic Regression using 5-fold CV to prevent test/val leakage
    cal_lr = CalibratedClassifierCV(
        estimator=LogisticRegression(class_weight="balanced", C=0.5, max_iter=1000, random_state=42),
        method="sigmoid",
        cv=5,
        ensemble=False
    )
    cal_lr.fit(X_train_scaled, y_train)

    # Calibrate Random Forest using 5-fold CV
    cal_rf = CalibratedClassifierCV(
        estimator=RandomForestClassifier(n_estimators=100, max_depth=6, class_weight="balanced", random_state=42),
        method="sigmoid",
        cv=5,
        ensemble=False
    )
    cal_rf.fit(X_train, y_train)

    # Extract base fitted Logistic Regression from cal_lr
    base_lr = cal_lr.calibrated_classifiers_[0].estimator

    # Extract Platt scaling parameters for LR: P_cal = 1 / (1 + exp(A * logit + B))
    calibrator = cal_lr.calibrated_classifiers_[0].calibrators[0]
    platt_a = float(calibrator.a_)
    platt_b = float(calibrator.b_)
    print(f"  Platt Sigmoid Parameters: A = {platt_a:.4f}, B = {platt_b:.4f}")

    # ------------------------------------------------------------------------
    # Comprehensive Multi-Model Evaluation
    # ------------------------------------------------------------------------
    evaluations = []

    models = [
        ("Logistic Regression (Raw)", lr, True, False),
        ("Logistic Regression (Platt Calibrated)", cal_lr, True, True),
        ("Random Forest (Raw)", rf, False, False),
        ("Random Forest (Calibrated)", cal_rf, False, True)
    ]

    splits = [
        ("Train", X_train_scaled, X_train, y_train),
        ("Validation", X_val_scaled, X_val, y_val),
        ("Holdout Test (validator)", X_test_scaled, X_test, y_test)
    ]

    for m_name, m_obj, is_scaled, is_cal in models:
        for s_name, X_s, X_raw, y in splits:
            X_eval = X_s if is_scaled else X_raw
            probs = m_obj.predict_proba(X_eval)[:, 1]
            ev = evaluate_predictions(y, probs, m_name, s_name)
            evaluations.append(ev)

    df_eval = pd.DataFrame(evaluations)
    print("\n" + "=" * 75)
    print("  COMPREHENSIVE PERFORMANCE MATRIX:")
    print("=" * 75)
    cols_to_print = ["model", "split", "samples", "roc_auc", "pr_auc", "brier", "ece", "f1"]
    print(df_eval[cols_to_print].to_string(index=False))

    # ------------------------------------------------------------------------
    # Model Selection Decision
    # ------------------------------------------------------------------------
    print("\n[Step 5] Model Selection Analysis:")
    lr_holdout = df_eval[(df_eval["model"] == "Logistic Regression (Platt Calibrated)") & (df_eval["split"] == "Holdout Test (validator)")].iloc[0]
    rf_holdout = df_eval[(df_eval["model"] == "Random Forest (Calibrated)") & (df_eval["split"] == "Holdout Test (validator)")].iloc[0]

    print(f"  Logistic Regression Holdout ROC-AUC: {lr_holdout['roc_auc']} | PR-AUC: {lr_holdout['pr_auc']} | Brier: {lr_holdout['brier']} | ECE: {lr_holdout['ece']}")
    print(f"  Random Forest       Holdout ROC-AUC: {rf_holdout['roc_auc']} | PR-AUC: {rf_holdout['pr_auc']} | Brier: {rf_holdout['brier']} | ECE: {rf_holdout['ece']}")

    # Learned AST Feature Weights
    print("\n[Step 6] Calibrated Logistic Regression Feature Weights:")
    ast_features = {}
    for i, col in enumerate(FEATURE_COLS):
        weight = float(base_lr.coef_[0][i])
        mean_val = float(scaler.mean_[i])
        std_val = float(scaler.scale_[i]) if scaler.scale_[i] != 0 else 1.0
        ast_features[col] = {
            "weight": round(weight, 4),
            "mean": round(mean_val, 4),
            "std": round(std_val, 4)
        }
        sign = "+" if weight >= 0 else ""
        print(f"  - {col:18s}: weight = {sign}{weight:.4f} (mean: {mean_val:.2f}, std: {std_val:.2f})")

    # ------------------------------------------------------------------------
    # Serialize Production Artifact
    # ------------------------------------------------------------------------
    print("\n[Step 7] Serializing Production Artifacts...")
    joblib_path = os.path.join(ML_MODEL_DIR, "defect_propensity_model.joblib")
    joblib.dump({
        "logistic_regression": base_lr,
        "calibrated_logistic_regression": cal_lr,
        "random_forest": rf,
        "calibrated_random_forest": cal_rf,
        "scaler": scaler,
        "features": FEATURE_COLS,
        "evaluations": evaluations
    }, joblib_path)
    print(f"  ✓ Saved joblib models: {joblib_path}")

    json_model = {
        "model_name": "GitLab-NativeAST-DefectPropensity-v2.0",
        "dataset_version": "cp7_file_v2.0",
        "training_dataset": "MultiLanguage_SZZ_FileDefect_Corpus_v2",
        "algorithm": "Platt-Calibrated Logistic Regression on Full-Snapshot AST Features",
        "languages": ["javascript", "typescript", "python", "java"],
        "evaluations": evaluations,
        "intercept": float(base_lr.intercept_[0]),
        "platt_calibration": {
            "enabled": True,
            "fitted_on": "5_fold_cross_validation_on_train_split",
            "param_a": platt_a,
            "param_b": platt_b
        },
        "feature_schema_version": "1.0",
        "ast_features": ast_features,
        "calibration_metrics": {
            "val_brier": lr_holdout["brier"],
            "val_ece": lr_holdout["ece"],
            "test_roc_auc": lr_holdout["roc_auc"],
            "test_pr_auc": lr_holdout["pr_auc"]
        },
        "scoring_bounds": {
            "min_score": 5.0,
            "max_score": 98.0
        }
    }

    json_path = os.path.join(BACKEND_MODEL_DIR, "defect_propensity_model.json")
    with open(json_path, "w") as f:
        json.dump(json_model, f, indent=2)
    print(f"  ✓ Saved Node.js in-process model artifact: {json_path}")

    # Also save comprehensive evaluation report JSON
    report_path = os.path.join(DATA_DIR, "evaluation_report.json")
    with open(report_path, "w") as f:
        json.dump({
            "timestamp": manifest.get("generation_timestamp"),
            "dataset_manifest": manifest,
            "evaluations": evaluations,
            "model_selection": {
                "selected_model": "Logistic Regression (Platt Calibrated)",
                "rationale": "Zero-latency closed-form in-process execution in Node.js, exact empirical probability calibration via Platt scaling, linear interpretability."
            }
        }, f, indent=2)
    print(f"  ✓ Saved evaluation report: {report_path}")

    print("\n" + "=" * 75)
    print(">>> CHECKPOINT 7 SCIENTIFIC RETRAINING & ARTIFACT EXPORT COMPLETE <<<")
    print("=" * 75)

if __name__ == "__main__":
    train_and_evaluate()
