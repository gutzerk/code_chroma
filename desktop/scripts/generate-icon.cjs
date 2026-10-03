const path = require("node:path");
const sharp = require("sharp");

const source = path.join(__dirname, "..", "build", "codechroma.svg");
const output = path.join(__dirname, "..", "build", "icon.png");

sharp(source)
  .resize(1024, 1024)
  .png()
  .toFile(output)
  .then(() => console.log(`wrote ${output} (1024x1024)`))
  .catch((error) => {
    console.error(`Failed to generate desktop icon from ${source}:`, error);
    process.exitCode = 1;
  });
