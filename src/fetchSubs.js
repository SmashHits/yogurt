// Fetch public subscribers for your channel (only public ones) and mark players accordingly
const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');
const {getOAuthClient} = require('./auth/oauth2client');
require('dotenv').config();


const PLAYERS_FILE = path.resolve(process.env.PLAYERS_FILE || './players.json');


async function fetchSubs() {
const auth = getOAuthClient();
const youtube = google.youtube({version: 'v3', auth});
const channelId = process.env.CHANNEL_ID;
let nextPageToken = null;
const publicSubs = new Set();


do {
const res = await youtube.subscriptions.list({
  part: 'subscriberSnippet',
  mySubscribers: true,
  maxResults: 50,
  pageToken: nextPageToken
});

console.log(
  "Fetched page:",
  res.data.items?.length || 0,
  "subs"
);





for (const item of res.data.items || []) {
if (item.subscriberSnippet && item.subscriberSnippet.channelId) {
publicSubs.add(item.subscriberSnippet.channelId);
}
}
nextPageToken = res.data.nextPageToken;
} while (nextPageToken);


const players = fs.existsSync(PLAYERS_FILE) ? JSON.parse(fs.readFileSync(PLAYERS_FILE)) : {};
let changed = !fs.existsSync(PLAYERS_FILE);
for (const id of Object.keys(players)) {
const was = players[id].isPublicSub || false;
players[id].isPublicSub = publicSubs.has(id);
if (players[id].isPublicSub !== was) changed = true;
}


if (changed) fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
console.log('Public subs fetched. Players updated:', PLAYERS_FILE);
}


fetchSubs().catch(err => { console.error(err); process.exit(1); });