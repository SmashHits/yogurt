// Helper that returns an authenticated google oauth2 client
const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();

const TOKEN_PATH = process.env.TOKEN_PATH || './tokens.json';

function getOAuthClient() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri =
    process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientId || !clientSecret) {
    throw new Error('Missing YouTube OAuth client credentials');
  }

  const oAuth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  let credentials = null;

  if (fs.existsSync(TOKEN_PATH)) {
    credentials = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } else if (process.env.YOUTUBE_REFRESH_TOKEN) {
    credentials = {
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
    };
  }

  if (!credentials?.refresh_token) {
    throw new Error('No refresh token available');
  }

  oAuth2Client.setCredentials(credentials);

  return oAuth2Client;
}

module.exports = { getOAuthClient, TOKEN_PATH };
