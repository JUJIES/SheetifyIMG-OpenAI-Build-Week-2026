"use strict";

process.env.SHEETIFYIMG_RUNTIME_MODE = "production";
process.env.NODE_ENV = "production";

const { startServer } = require("./dev-server");

startServer().catch((error) => {
  console.error(`[SheetifyIMG] production start failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
});
