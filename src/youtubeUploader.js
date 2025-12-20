const fs = require("fs");
const { google } = require("googleapis");
require('dotenv').config();

async function upload() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
  });

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client,
  });

  console.log("Uploading video...");

  const res = await youtube.videos.insert({
    part: "snippet,status",
    requestBody: {
      snippet: {
        title: "Daily Plinko Simulation",
        description: "Automatically generated simulation.",
        tags: ["plinko", "physics", "simulation"],
      },
      status: {
        privacyStatus: "private",
      },
    },
    media: {
      body: fs.createReadStream("output.mp4"),
    },
  });

  console.log("Upload complete!");
  console.log(res.data);
}

upload().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});

module.exports = { upload };
