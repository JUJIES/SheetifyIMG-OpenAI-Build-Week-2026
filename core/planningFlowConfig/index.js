"use strict";

const PLANNING_FLOWS = Object.freeze({
  LEGACY: "legacy",
  V2: "v2"
});

function normalizePlanningFlow(value) {
  return String(value || "").trim().toLowerCase() === PLANNING_FLOWS.V2
    ? PLANNING_FLOWS.V2
    : PLANNING_FLOWS.LEGACY;
}

function resolvePlanningFlow(options = {}, env = null) {
  const runtimeEnv = env || options.env || process.env;
  return normalizePlanningFlow(
    options.trustedPlanningFlowOverride
      || runtimeEnv.SHEETIFYIMG_PLANNING_FLOW
      || PLANNING_FLOWS.LEGACY
  );
}

module.exports = {
  PLANNING_FLOWS,
  normalizePlanningFlow,
  resolvePlanningFlow
};
