// Master runner: update players → download images → render simulation video → upload
const { spawnSync } = require("child_process");
const path = require("path");

function runScript(relPath) {
  const scriptPath = path.resolve(__dirname, relPath);
  console.log("\n==> Running", scriptPath);

  const result = spawnSync("node", [scriptPath], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    throw new Error("❌ Step failed: " + relPath);
  }
}

async function main() {
  runScript("src/fetchComments.js");
  runScript("src/fetchSubs.js");
  runScript("src/updatePlayers.js"); // fetch new users from comments/subs
  runScript("src/downloadImages.js"); // download profile pictures
  runScript("src/renderer.js"); // run full physics + render to mp4
  runScript("src/uploadVideo.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
