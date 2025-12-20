// src/downloadImages.js
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const fetch = require("node-fetch"); // npm install node-fetch@2
const { getOAuthClient } = require("./auth/oauth2client");

const PLAYERS_FILE = path.resolve(__dirname, "../players.json");
const OUT_DIR = path.resolve(__dirname, "../output/images");

async function downloadImage(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const buffer = await res.buffer();
  fs.writeFileSync(dest, buffer);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const auth = getOAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  if (!fs.existsSync(PLAYERS_FILE)) {
    console.error("players.json not found:", PLAYERS_FILE);
    process.exit(1);
  }

  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));
  const channelIds = Object.keys(players);

  for (const id of channelIds) {
    const player = players[id];
    const outPath = path.join(OUT_DIR, `${id}.png`);

    if (fs.existsSync(outPath)) {
      console.log(`✅ Already downloaded: ${player.name}`);
      continue;
    }

    try {
      const res = await youtube.channels.list({
        part: "snippet",
        id
      });

      const snippet = res.data.items?.[0]?.snippet;
      if (!snippet) {
        console.warn(`⚠️ No snippet found for ${player.name} (${id})`);
        continue;
      }

      const pfpUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url;
      if (!pfpUrl) {
        console.warn(`⚠️ No profile picture for ${player.name} (${id})`);
        continue;
      }

      await downloadImage(pfpUrl, outPath);
      console.log(`📥 Downloaded: ${player.name}`);
    } catch (e) {
      console.error(`❌ Failed to download ${player.name} (${id}):`, e.message);
    }
  }

  console.log("✅ All profile pictures processed.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
