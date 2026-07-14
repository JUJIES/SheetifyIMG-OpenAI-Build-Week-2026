"use strict";

const PLANNING_FLOWS = Object.freeze({
  LEGACY: "legacy",
  V2: "v2"
});
const DEFAULT_PLANNING_FLOW = PLANNING_FLOWS.V2;

function normalizePlanningFlow(value, fallback = DEFAULT_PLANNING_FLOW) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (Object.values(PLANNING_FLOWS).includes(normalized)) {
    return normalized;
  }
  throw new Error(`SHEETIFYIMG_PLANNING_FLOW must be "${PLANNING_FLOWS.V2}" or "${PLANNING_FLOWS.LEGACY}".`);
}

function resolvePlanningFlow(options = {}, env = null) {
  const runtimeEnv = env || options.env || process.env;
  return normalizePlanningFlow(
    options.trustedPlanningFlowOverride
      || runtimeEnv.SHEETIFYIMG_PLANNING_FLOW
      || DEFAULT_PLANNING_FLOW
  );
}

module.exports = {
  DEFAULT_PLANNING_FLOW,
  PLANNING_FLOWS,
  normalizePlanningFlow,
  resolvePlanningFlow
};
