// JS wrapper required by the step instructions.
// Loads the TypeScript implementation via ts-node.
require("ts-node/register/transpile-only");

module.exports = require("./db.ts");
