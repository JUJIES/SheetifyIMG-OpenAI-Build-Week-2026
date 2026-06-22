"use strict";

const PRODUCTION_SCHEMA_VERSION = 2;

const PROJECT_TYPES = Object.freeze({
  SINGLE_WORKSHEET: "single_worksheet",
  SERIES: "series"
});

const LEGACY_PROJECT_TYPES = Object.freeze({
  BUNDLE: "bundle",
  UNKNOWN: "unknown"
});

const SOURCE_TYPES = Object.freeze({
  PRODUCTION: "production",
  LEGACY_FIXTURE: "legacy_fixture",
  IMPORTED: "imported"
});

const ARTIFACT_TYPES = Object.freeze({
  INPUT_BATCH: "input_batch",
  LESSON_BRIEF: "lessonbrief",
  CONTENT_MIRROR: "content_mirror",
  WARNINGS: "warnings",
  IMAGESHEET_BRIEF: "imagesheet_brief",
  RUN: "run",
  CANDIDATE: "candidate",
  SELECTION: "selection",
  EXPORT: "export",
  PDF: "pdf",
  SCREENSHOT: "screenshot"
});

const ARTIFACT_STATUSES = Object.freeze({
  DRAFT: "draft",
  CURRENT: "current",
  APPROVED: "approved",
  OUTDATED: "outdated",
  SELECTED: "selected",
  EXPORTED: "exported",
  ERROR: "error"
});

const WORKFLOW_STEPS = Object.freeze([
  "auftrag",
  "input",
  "brief",
  "content",
  "pruefung",
  "freigabe",
  "kandidaten",
  "auswahl",
  "export"
]);

const EVENT_TYPES = Object.freeze({
  PROJECT_CREATED: "project_created",
  USER_MESSAGE: "user_message",
  ASSISTANT_MESSAGE: "assistant_message",
  INPUT_BATCH_CREATED: "input_batch_created",
  ARTIFACT_CREATED: "artifact_created",
  ARTIFACT_UPDATED: "artifact_updated",
  ARTIFACT_APPROVED: "artifact_approved",
  ARTIFACT_DEPRECATED: "artifact_deprecated",
  QC_COMPLETED: "qc_completed",
  RUN_STARTED: "run_started",
  RUN_FINISHED: "run_finished",
  CANDIDATE_CREATED: "candidate_created",
  CANDIDATE_SELECTED: "candidate_selected",
  EXPORT_CREATED: "export_created",
  CANVAS_FEEDBACK: "canvas_feedback",
  ERROR: "error"
});

module.exports = {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  LEGACY_PROJECT_TYPES,
  PRODUCTION_SCHEMA_VERSION,
  PROJECT_TYPES,
  SOURCE_TYPES,
  WORKFLOW_STEPS
};

