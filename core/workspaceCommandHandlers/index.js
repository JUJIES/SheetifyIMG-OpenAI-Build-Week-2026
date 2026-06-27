"use strict";

const { candidateCommandHandlers } = require("./candidateCommands");
const { conceptCommandHandlers } = require("./conceptCommands");
const { imagePrepCommandHandlers } = require("./imagePrepCommands");
const { worksheetCommandHandlers } = require("./worksheetCommands");

const WORKSPACE_COMMAND_HANDLERS = Object.freeze({
  ...conceptCommandHandlers,
  ...imagePrepCommandHandlers,
  ...candidateCommandHandlers,
  ...worksheetCommandHandlers
});

async function runWorkspaceCommandHandler(context) {
  const handler = WORKSPACE_COMMAND_HANDLERS[context.command];
  if (!handler) {
    throw new Error(`Unsupported workspace command: ${context.command}`);
  }
  return handler(context);
}

module.exports = {
  WORKSPACE_COMMAND_HANDLERS,
  runWorkspaceCommandHandler
};
