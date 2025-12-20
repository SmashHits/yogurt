// Uses Puppeteer to open a local HTML simulation and record a canvas to PNG frames
const SIM_DURATION_MS = parseInt(process.env.SIM_DURATION_MS || '15000');
const FPS = parseInt(process.env.FRAME_RATE || '30');


async function main() {
if (!fs.existsSync(path.join(__dirname, '..', 'simulation', 'index.html'))) {
console.error('Place your browser simulation at ./simulation/index.html');
process.exit(1);
}
if (!fs.existsSync(PLAYERS_FILE)) {
console.error('players.json not found at', PLAYERS_FILE);
process.exit(1);
}


// read players and build an array of participants (ids)
const playersObj = JSON.parse(fs.readFileSync(PLAYERS_FILE));
const participants = Object.keys(playersObj);
if (participants.length === 0) {
console.error('No participants found in players.json');
process.exit(1);
}


fs.rmSync(FRAME_DIR, {recursive: true, force: true});
fs.mkdirSync(FRAME_DIR, {recursive: true});


const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox','--disable-setuid-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1080, height: 1920});
const simPath = 'file://' + path.join(__dirname, '..', 'simulation', 'index.html');
await page.goto(simPath, {waitUntil: 'networkidle0'});


// inject players array (with basic info) into the page
const playersArray = participants.map(id => ({id, name: playersObj[id].name || id, img: '../output/images/' + id + '.jpg'}));
await page.evaluate(p => { window.players = p; }, playersArray);


// Let the page run rounds until it reports a winner via window.getWinner()
// We'll record frames for a fixed maximum duration and poll for winner at the end.
const maxFrames = Math.ceil(SIM_DURATION_MS / (1000 / FPS));


for (let frame=0; frame<maxFrames; frame++) {
const dataUrl = await page.evaluate(() => {
if (typeof window.captureFrame === 'function') return window.captureFrame();
const c = document.querySelector('canvas');
return c ? c.toDataURL('image/png') : null;
});
if (!dataUrl) break;
const base64 = dataUrl.split(',')[1];
const buf = Buffer.from(base64, 'base64');
const fname = path.join(FRAME_DIR, String(frame).padStart(6,'0') + '.png');
fs.writeFileSync(fname, buf);
if (frame % 50 === 0) console.log('frame', frame);
await new Promise(r => setTimeout(r, 1000 / FPS));
}


// Ask page who won (page determines winner after repeated rounds)
const winner = await page.evaluate(() => {
if (typeof window.getWinner === 'function') return window.getWinner();
return null;
});


if (winner) {
console.log('Winner determined:', winner.id || winner);
fs.writeFileSync(path.join(OUTPUT_DIR, 'winner.json'), JSON.stringify(winner, null, 2));
} else {
console.log('No winner determined by page.');
}


await browser.close();
console.log('Frames saved to', FRAME_DIR);
}


main().catch(err => { console.error(err); process.exit(1); });