// src/bootstrapPlayersFromSubs.js
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { getOAuthClient } = require("./auth/oauth2client");
require("dotenv").config();

const PLAYERS_FILE = path.resolve("./players.json");

async function bootstrap() {
  const auth = getOAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  const players = fs.existsSync(PLAYERS_FILE)
    ? JSON.parse(fs.readFileSync(PLAYERS_FILE))
    : {};

  let nextPageToken = null;
  let count = 0;

  do {
    const res = await youtube.subscriptions.list({
      part: "subscriberSnippet",
      mySubscribers: true,
      maxResults: 50,
      pageToken: nextPageToken,
    });

    for (const item of res.data.items || []) {
      const id = item.subscriberSnippet.channelId;
      const name = item.subscriberSnippet.title;

      if (!players[id]) {
        players[id] = {
          name,
          enteredVia: "bootstrap",
          balls: 2,
          joinedAt: new Date().toISOString(),
          isPublicSub: true,
        };
        count++;
      }
    }

    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);

  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
  console.log(`✅ Bootstrapped ${count} public subscribers`);
}

bootstrap().catch(console.error);
