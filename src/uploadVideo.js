// -----------------------------
// IMPORTS MUST BE AT THE TOP
// -----------------------------
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { getOAuthClient } = require("./auth/oauth2client");
require("dotenv").config();

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || "./output");
const FILE = path.join(OUTPUT_DIR, "video.mp4");

// -----------------------------
// DAY COUNTER
// -----------------------------
const SERIES_START_DATE = new Date("2025-12-20T00:00:00Z"); // day 0 before this

function getDayNumber() {
  const now = new Date();
  const diff = now - SERIES_START_DATE;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

// -----------------------------
// DEBUG START
// -----------------------------
console.log("STEP 1: Script loaded");

// -----------------------------
// MAIN
// -----------------------------
async function upload() {
  console.log("STEP 2: getOAuthClient() start");
  const auth = getOAuthClient();
  console.log("STEP 3: OAuth loaded");

  console.log("STEP 4: Checking file:", FILE, "exists:", fs.existsSync(FILE));
  if (!fs.existsSync(FILE)) {
    console.error("No video to upload at", FILE);
    process.exit(1);
  }

  const youtube = google.youtube({ version: "v3", auth });

  const day = getDayNumber();

  const title = `Day ${day} – My viewers compete in a physics simulation!`;

  const description = `
  Day ${day} of making my viewers compete against each other.

  How to enter:
  • Comment "ENTER" on any Short
  • Public subscribers get 2 balls

  New video every day.

  #shorts #youtubeshorts
  `.trim();

  console.log("STEP 5: Uploading...");
  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        tags: [
          "youtube shorts",
          "shorts",
          "simulation",
          "pachinko",
          "viewer interaction",
          "subscribers",
          "tournament",
        ],
        categoryId: "20",
      },
      status: {
        privacyStatus: process.env.UPLOAD_PRIVACY || "private",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(FILE),
    },
  });

  console.log("STEP 6: Uploaded video id:", res.data.id);
}

upload().catch((err) => {
  console.error("UPLOAD ERROR:", err);
  process.exit(1);
});
