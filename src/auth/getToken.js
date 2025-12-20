// Run this once to produce tokens.json by performing the oauth consent flow (manual copy/paste)
const {google} = require('googleapis');
const readline = require('readline');
const fs = require('fs');
require('dotenv').config();


const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';
const TOKEN_PATH = process.env.TOKEN_PATH || './tokens.json';


if (!CLIENT_ID || !CLIENT_SECRET) {
console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env');
process.exit(1);
}


const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = [
'https://www.googleapis.com/auth/youtube.readonly',
'https://www.googleapis.com/auth/youtube.upload'
];


async function main() {
const authUrl = oAuth2Client.generateAuthUrl({
access_type: 'offline',
scope: SCOPES,
prompt: 'consent'
});
console.log('Visit the following URL and paste the code here:');
console.log(authUrl);


const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter code: ', async (code) => {
try {
const {tokens} = await oAuth2Client.getToken(code);
fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
console.log('Token stored to', TOKEN_PATH);
} catch (err) {
console.error('Error retrieving token', err);
}
rl.close();
});
}


main();