"use strict";

const { depositCandidateAsWorksheet } = require("../worksheetLibraryManager");
const { worksheetOptions } = require("./shared");

function depositWorksheet(context) {
  return depositCandidateAsWorksheet({
    ...context.payload,
    projectId: context.projectId
  }, worksheetOptions(context));
}

const worksheetCommandHandlers = {
  deposit_worksheet: depositWorksheet
};

module.exports = {
  worksheetCommandHandlers
};
