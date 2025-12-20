const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { getOAuthClient } = require("./auth/oauth2client");
require("dotenv").config();

const PLAYERS_FILE = path.resolve(process.env.PLAYERS_FILE || "./players.json");
const MAX_SHORTS = 5; // don’t abuse quota

async function fetchRecentShortIds(youtube) {
  const res = await youtube.search.list({
    part: "id",
    forMine: true,
    type: "video",
    order: "date",
    maxResults: MAX_SHORTS,
  });

  return res.data.items.map(v => v.id.videoId);
}

async function fetchCommentsForVideo(youtube, videoId) {
  try {
    const res = await youtube.commentThreads.list({
      part: "snippet",
      videoId,
      maxResults: 100,
      textFormat: "plainText",
    });

    return res.data.items || [];
  } catch (err) {
    // Shorts often fail here — do NOT crash
    console.warn(`⚠️ No comments for video ${videoId}`);
    return [];
  }
}

async function main() {
  const auth = getOAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  const players = fs.existsSync(PLAYERS_FILE)
    ? JSON.parse(fs.readFileSync(PLAYERS_FILE))
    : {};

  const videoIds = await fetchRecentShortIds(youtube);
  console.log("🔎 Checking Shorts:", videoIds);

  let added = 0;

  for (const videoId of videoIds) {
    const comments = await fetchCommentsForVideo(youtube, videoId);

    for (const item of comments) {
      const snippet = item.snippet.topLevelComment.snippet;
      const text = snippet.textDisplay.trim().toUpperCase();

      if (!text.includes("ENTER")) continue;

      const channelId = snippet.authorChannelId?.value;
      if (!channelId) continue;

      if (!players[channelId]) {
        players[channelId] = {
          name: snippet.authorDisplayName,
          enteredVia: "shorts",
          balls: 1,
          joinedAt: new Date().toISOString(),
        };
        added++;
      }
    }
  }

  if (added > 0) {
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
  }

  console.log(`✅ Added ${added} new player(s)`);
}

main().catch(err => {
  console.error("❌ Shorts fetch failed:", err.message);
  process.exit(1);
});
