"use strict";

function commandSnapshot(workspace = {}) {
  return (workspace.commands || []).map((command) => ({
    id: command.id,
    label: command.label,
    enabled: command.enabled,
    reason: command.reason || null,
    defaultCandidateId: command.defaultCandidateId || null,
    defaultPayload: command.defaultPayload || null,
    requiresConfirmation: command.requiresConfirmation || false
  }));
}

function documentSnapshot(workspace = {}) {
  const documents = workspace.documents || {};
  return {
    brief: {
      status: documents.brief?.status || "missing",
      data: documents.brief?.data || null
    },
    content: {
      status: documents.content?.status || "missing",
      data: documents.content?.data || null
    },
    warnings: {
      count: documents.warnings?.warnings?.length || 0,
      data: documents.warnings || null
    }
  };
}

function messageSnapshot(messages = []) {
  return messages.slice(-12).map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    createdAt: message.createdAt || null,
    attachments: visualFeedbackSnapshot(message.attachments || [])
  }));
}

function defaultCanvasFocus(input = {}) {
  return {
    mode: input.canvasFocus?.mode || input.activeCanvasMode || null,
    page: input.canvasFocus?.page || null,
    candidateId: input.canvasFocus?.candidateId || null,
    runId: input.canvasFocus?.runId || null,
    blockId: input.canvasFocus?.blockId || null,
    selectionType: input.canvasFocus?.selectionType || "none",
    selectionRect: input.canvasFocus?.selectionRect || null
  };
}

function visualFeedbackSnapshot(attachments = []) {
  return attachments
    .filter((attachment) => attachment.kind === "visual_feedback")
    .map((attachment) => ({
      id: attachment.id || null,
      label: attachment.label || null,
      path: attachment.path || null,
      source: attachment.source || null,
      userInstructionRequired: attachment.userInstructionRequired === true
    }));
}

function firstIncompleteStep(workspace = {}) {
  return (workspace.steps || []).find((step) => !step.complete)?.id || "auftrag";
}

function activeArtifactFromCanvas(workspace = {}, canvasFocus = {}) {
  const mode = canvasFocus.mode;
  if (mode === "brief") {
    return workspace.documents?.brief || null;
  }
  if (mode === "content") {
    return workspace.documents?.content || null;
  }
  if (mode === "warnings") {
    return workspace.documents?.warnings || null;
  }
  if (mode === "candidates" || mode === "selection") {
    return workspace.latestRun || null;
  }
  if (mode === "lessonbrief_proposal") {
    return workspace.proposals?.latestLessonBrief || null;
  }
  if (mode === "content_proposal") {
    return workspace.proposals?.latestContentMirror || null;
  }
  if (mode === "warnings_proposal") {
    return workspace.proposals?.latestContentWarnings || null;
  }
  if (mode === "image_spec_proposal") {
    return workspace.proposals?.latestImageSpec || workspace.proposals?.activeImageSpec || null;
  }
  return null;
}

function buildProductionContext({ workspace = {}, messages = [], input = {}, route = null, now = null } = {}) {
  const canvasFocus = defaultCanvasFocus(input);
  return {
    app: "SheetifyIMG",
    createdAt: now || input.now || new Date().toISOString(),
    uiEvent: input.uiEvent || "chat_message",
    route: route
      ? {
        purpose: route.purpose,
        route: route.route,
        promptNames: route.promptNames || []
      }
      : null,
    pipelineState: input.pipelineState || firstIncompleteStep(workspace),
    userMessage: String(input.message || "").trim() || null,
    canvasFocus,
    visualFeedback: visualFeedbackSnapshot(input.attachments || []),
    activeArtifact: activeArtifactFromCanvas(workspace, canvasFocus),
    project: workspace.project || null,
    teachingContext: workspace.teachingContext || null,
    inputReadiness: workspace.inputReadiness || null,
    approval: workspace.approval || null,
    documents: documentSnapshot(workspace),
    latestRun: workspace.latestRun || null,
    proposals: workspace.proposals || null,
    series: workspace.series
      ? {
        title: workspace.series.title,
        worksheetCount: workspace.series.worksheets?.length || 0,
        worksheets: (workspace.series.worksheets || []).map((entry) => ({
          projectId: entry.projectId,
          title: entry.title,
          position: entry.position,
          includedInSeriesExport: entry.includedInSeriesExport !== false
        }))
      }
      : null,
    steps: workspace.steps || [],
    allowedActions: commandSnapshot(workspace),
    recentMessages: messageSnapshot(messages)
  };
}

function productionContextToPrompt(context) {
  return [
    "Aktueller SheetifyIMG-Produktionskontext:",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

module.exports = {
  buildProductionContext,
  productionContextToPrompt
};
