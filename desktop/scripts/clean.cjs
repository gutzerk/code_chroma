const { rmSync } = require("node:fs");

rmSync("out", { recursive: true, force: true });
rmSync("tsconfig.tsbuildinfo", { force: true });
