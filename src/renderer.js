// src/renderer.js
// Round-based pachinko renderer with side-survivor logic.
// Replaces previous renderer; writes output/video.mp4
//
// Requires:
//   npm install canvas fluent-ffmpeg ffmpeg-static
// Assets:
//   assets/font.ttf        (optional, name exactly)
//   assets/music/song.mp3  (optional)
// Data:
//   data/players.json      (optional) -- used to set number of entrants
//
// Output:
//   output/video.mp4

const fs = require("fs");
const path = require("path");
const { createCanvas, registerFont } = require("canvas");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const { PassThrough } = require("stream");
const START_DATE = new Date("2025-12-20T00:00:00Z"); // day 1
const now = new Date();
const DAY_NUMBER = Math.floor((now - START_DATE) / (1000 * 60 * 60 * 24));

console.log("Day number:", DAY_NUMBER);

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

// CONFIG
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30; // keep reliable on CI/local
const INTRO_TIME = 5; // seconds of intro text & spawning flow
const WINNER_TIME = 4; // seconds winner screen
const BALL_SPAWN_INTERVAL_MS = 80; // flow rate for spawning visual (ms between new drops)
const DEFAULT_ENTRANTS = 60; // fallback if no data/players.json
const PEG_ROWS = 12;
const PEG_SPACING_X = 80;
const PEG_SPACING_Y = 120;
const PEG_RADIUS = 8;
const BALL_RADIUS = 14;
const GRAVITY = 0.32;
const STEPS_PER_FRAME = 4; // increase internal steps per frame for faster physics feel

const OUT_DIR = path.resolve(__dirname, "../output");
const OUTPUT_FILE = path.join(OUT_DIR, "video.mp4");
const FONT_PATH = path.resolve(__dirname, "../assets/font.ttf");
const MUSIC_PATH = path.resolve(__dirname, "../assets/music/song.mp3");
const PLAYERS_PATH = path.resolve(__dirname, "../players.json");

const { loadImage } = require("canvas");

const pfpImages = {};

async function loadPFPs(players) {
  for (const p of players) {
    const imgPath = path.join(OUT_DIR, "images", `${p.id}.png`);

    if (!fs.existsSync(imgPath)) {
      console.warn("Missing PFP:", imgPath);
      continue;
    }

    try {
      pfpImages[p.id] = await loadImage(imgPath);
      console.log("Loaded PFP for", p.name);
    } catch (e) {
      console.warn("Failed to load image:", p.id, e.message);
    }
  }
}


// font
let haveFont = false;
if (fs.existsSync(FONT_PATH)) {
  try {
    registerFont(FONT_PATH, { family: "MainFont" });
    haveFont = true;
    console.log("Loaded font:", FONT_PATH);
  } catch (e) {
    console.warn("Failed to register font:", e);
  }
} else {
  console.warn("font.ttf not found at assets/font.ttf — using default font.");
}

// Helpers
function loadPlayers() {
  if (!fs.existsSync(PLAYERS_PATH)) return [];

  const raw = JSON.parse(fs.readFileSync(PLAYERS_PATH, "utf8"));

  // Convert object → array
  return Object.entries(raw).map(([id, data]) => ({
    id,
    name: data.name,
    balls: data.balls || 1
  }));
}

// Peg grid
function makePegGrid() {
  const pegs = [];

  const PEG_ROWS = 12;
  const BASE_COLS = 12;  // even rows use 12 pegs
  const WALL_PADDING = 70;

  // total horizontal space available
  const usableWidth = WIDTH - WALL_PADDING * 2;
  const spacingX = usableWidth / (BASE_COLS - 1);

  for (let row = 0; row < PEG_ROWS; row++) {
    const y = 250 + row * PEG_SPACING_Y;

    const isEven = row % 2 === 0;
    const colsThisRow = isEven ? 12 : 11;

    // 12-peg rows start exactly at WALL_PADDING
    // 11-peg rows start halfway between 12-peg grid positions
    const baseOffset = WALL_PADDING + (isEven ? 0 : spacingX / 2);

    for (let col = 0; col < colsThisRow; col++) {
      let x = baseOffset + col * spacingX;

      // optional micro jitter (keeps your original anti-deadlock trick)
      x += (col % 2) * 1.5;

      pegs.push({ x, y });
    }
  }

  return pegs;
}

// Ball factory
function makeBall(seedOffset = 0) {
  return {
    x: WIDTH / 2 + (Math.random() * 200 - 100),
    y: -50,
    vx: 0,
    vy: 0,
    age: 0,
    seedOffset,
  };
}

function updateBall(ball, pegs) {
  // -----------------------
  // GRAVITY
  // -----------------------
  ball.vy += GRAVITY;

  // tiny noise so balls don't fall perfectly symmetrical
  ball.vx += (Math.random() * 0.4 - 0.2);

  // clamp vertical speed
  if (ball.vy > 18) ball.vy = 18;

  // clamp horizontal speed
  if (ball.vx > 6) ball.vx = 6;
  if (ball.vx < -6) ball.vx = -6;

  // -----------------------
  // MOVE
  // -----------------------
  ball.x += ball.vx;
  ball.y += ball.vy;

  // -----------------------
  // WALL COLLISIONS
  // -----------------------
  const left = BALL_RADIUS;
  const right = WIDTH - BALL_RADIUS;

  if (ball.x < left) {
    ball.x = left;
    ball.vx = Math.abs(ball.vx) * 0.45; // medium bounce
  }

  if (ball.x > right) {
    ball.x = right;
    ball.vx = -Math.abs(ball.vx) * 0.45;
  }

  // -----------------------
  // PEG COLLISIONS
  // -----------------------
  for (const p of pegs) {
    const dx = ball.x - p.x;
    const dy = ball.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = BALL_RADIUS + PEG_RADIUS;

    if (dist < minDist) {
      // collision normal
      const angle = Math.atan2(dy, dx);
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);

      // push ball out of peg
      const overlap = minDist - dist;
      ball.x += nx * overlap * 0.8;
      ball.y += ny * overlap * 0.8;

      // reflect velocity (but damped heavily)
      let speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

      speed *= 0.55; // MEDIUM CHAOS BOUNCE

      // random chaotic variation
      const randomness = 0.6 + Math.random() * 0.5;

      ball.vx = nx * speed * randomness;
      ball.vy = ny * speed * randomness;

      // clamp again to prevent insane launches
      if (ball.vx > 6) ball.vx = 6;
      if (ball.vx < -6) ball.vx = -6;
      if (ball.vy > 18) ball.vy = 18;
    }
  }
}

// Bin math (where ball lands)
function getBinIndex(x, binCount) {
  const w = WIDTH / binCount;
  let idx = Math.floor(x / w);
  if (idx < 0) idx = 0;
  if (idx >= binCount) idx = binCount - 1;
  return idx;
}

// Renderer
async function render() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(OUTPUT_FILE)) {
    try { fs.unlinkSync(OUTPUT_FILE); } catch (_) {}
  }

  // entrants
  let activePlayers = Object.keys(playersJSON).map(id => {
    const p = playersJSON[id];
    return {
      id: id,
      name: p.name,
      totalBalls: p.balls, // max balls per round
      currentBalls: p.balls, // will decrement if some are eliminated
    };
  });

  if (activePlayers.length === 0) {
    console.warn("No players found — using fallback placeholders");
    for (let i = 0; i < DEFAULT_ENTRANTS; i++) {
      activePlayers.push({ id: `P${i}`, name: `P${i}`, balls: 1 });
    }
  }

  await loadPFPs(activePlayers);
  
  console.log("Loaded players:", activePlayers.length);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const pegs = makePegGrid();
  const binCount = PEG_ROWS + 1;
  const binWidth = WIDTH / binCount;

  // zones for visuals: side bins (survive) are bins 0..edgeBins-1 and binCount-edgeBins..binCount-1
  const edgeBins = 2; // leftmost/rightmost 2 bins count as side survivors
  const centerStart = edgeBins;
  const centerEnd = binCount - edgeBins - 1; // inclusive index - anything in between eliminates

  // ffmpeg writer via PassThrough
  const frameStream = new PassThrough();
  const command = ffmpeg()
    .addInput(frameStream)
    .inputFormat("image2pipe")
    .inputFPS(FPS);

  if (fs.existsSync(MUSIC_PATH)) {
    command.addInput(MUSIC_PATH);
  }

  command
    .videoCodec("libx264")
    .size(`${WIDTH}x${HEIGHT}`)
    .outputOptions([`-r ${FPS}`, "-pix_fmt yuv420p", "-movflags +faststart", "-shortest"])
    .output(OUTPUT_FILE)
    .on("start", (cmdline) => console.log("FFmpeg started:", cmdline.split(" ").slice(0, 6).join(" ") + " ..."))
    .on("progress", (p) => { if (p && p.frames) process.stdout.write(`\rframes:${p.frames}`); })
    .on("end", () => console.log("\nFFmpeg finished."))
    .on("error", (err) => { console.error("\nFFmpeg error:", err); process.exit(1); })
    .run();

  
  // State for rounds
  let round = 0;
  let spawning = false;
  let spawnTimer = 0;
  let spawnIndex = 0; // which player in current round will spawn next
  let pendingBalls = []; // currently falling balls (with player ref and ball object)
  let nextRoundPlayers = []; // survivors that will be active next round
  let winnerPlayer = null;
  let showWinnerFrames = 0;

  const totalIntroFrames = INTRO_TIME * FPS;
  const totalWinnerFrames = WINNER_TIME * FPS;
  let frame = 0;
  const maxFrames = 60 * FPS; // safety cap 60s

  console.log("Starting rounds. Initial players:", activePlayers.length);

  // Helper to start a new round
  function startRound() {
    round++;
    spawnIndex = 0;
    pendingBalls = [];
    nextRoundPlayers = [];
  
    // reset currentBalls for surviving players only
    activePlayers.forEach(p => p.currentBalls = p.totalBalls);
  
    spawning = true;
    spawnTimer = 0;
    console.log(`--- START ROUND ${round} — players: ${activePlayers.length} ---`);
  }

  // Start first round
  startRound();

  // spawn a ball for a specific player index
  function spawnBallForPlayer(player) {
    if (player.currentBalls <= 0) return;
    const ball = makeBall(player.id);
    pendingBalls.push({ player, ball });
    player.currentBalls--;
  }

  // main loop via setInterval, writing frames to ffmpeg
  const intervalMs = Math.round(1000 / FPS);
  const spawnIntervalMs = BALL_SPAWN_INTERVAL_MS;
  const interval = setInterval(() => {
    // Clear
    ctx.fillStyle = "#081018";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Draw pegs
    ctx.fillStyle = "#4a7";
    for (const p of pegs) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, PEG_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw zone overlay: center (red) vs side (green)
    // side zones
    ctx.fillStyle = "rgba(0,120,0,0.08)";
    ctx.fillRect(0, HEIGHT - 220, edgeBins * binWidth, 220);
    ctx.fillRect(WIDTH - edgeBins * binWidth, HEIGHT - 220, edgeBins * binWidth, 220);
    // center zone
    ctx.fillStyle = "rgba(180,20,20,0.08)";
    ctx.fillRect(edgeBins * binWidth, HEIGHT - 220, WIDTH - edgeBins * 2 * binWidth, 220);

    // spawn flow logic
    if (spawning && spawnIndex < activePlayers.length) {
      spawnTimer += intervalMs;
      while (spawnTimer >= spawnIntervalMs && spawnIndex < activePlayers.length) {
        const p = activePlayers[spawnIndex];
        spawnBallForPlayer(p);
        spawnIndex++;
        spawnTimer -= spawnIntervalMs;
      }
    }

    // Advance physics multiple steps to make motion faster (but still stable)
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      for (const entry of pendingBalls) {
        updateBall(entry.ball, pegs);
      }
    }

    // Draw pending balls and check landings
    for (let i = pendingBalls.length - 1; i >= 0; i--) {
      const entry = pendingBalls[i];
      const b = entry.ball;
      const player = entry.player;

      if (pfpImages[player.id]) {
        // Draw ball as player PFP clipped to a circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(pfpImages[player.id], b.x - BALL_RADIUS, b.y - BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2);
        ctx.restore();
      } else {
        // fallback: draw solid circle
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#56bfff";
        ctx.fill();
      }
      // landed
      if (b.y > HEIGHT - 120) {
        // compute bin
        const bin = getBinIndex(b.x, binCount);
        // decide: side bins survive, center bins eliminated
        const isSide = (bin < edgeBins) || (bin >= binCount - edgeBins);
        if (isSide) {
          // survivor — add to nextRoundPlayers (but keep unique)
          nextRoundPlayers.push(entry.player);
          // small visual: draw green flash (we'll let frame display it and then remove)
        } else {
          // eliminated — do nothing
        }
        // remove ball from pending
        pendingBalls.splice(i, 1);
      }
    }

    // Draw some HUD: round / remaining
    ctx.fillStyle = "#fff";
    ctx.font = haveFont ? "bold 42px MainFont" : "bold 42px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Round ${round}`, 40, 60);
    ctx.fillText(`Active: ${activePlayers.length}`, 40, 110);
    ctx.textAlign = "center";

    // Intro text during initial frames
    if (frame < totalIntroFrames) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.font = haveFont ? "bold 72px MainFont" : "bold 72px sans-serif";
      ctx.fillText(`Day #${DAY_NUMBER} of making my viewers`, WIDTH / 2, HEIGHT * 0.22);
      ctx.fillText("compete against each other.", WIDTH / 2, HEIGHT * 0.30);
      ctx.globalAlpha = 1;
    }

    // If we've finished spawning for this round and no pending balls remain => round complete
    if (spawning && spawnIndex >= activePlayers.length && pendingBalls.length === 0) {
      spawning = false;
      // dedupe nextRoundPlayers by id
      const survivorsById = {};
      nextRoundPlayers.forEach(p => { survivorsById[p.id] = p; });
      const survivors = Object.values(survivorsById);
      console.log(`Round ${round} complete. Survivors: ${survivors.length}`);
      // If only one survivor => winner
      if (survivors.length === 1) {
        winnerPlayer = survivors[0];
        showWinnerFrames = 0;
        console.log("WINNER:", winnerPlayer);
      } else if (survivors.length === 0) {
        // no survivors: fallback — choose random from previous activePlayers
        if (activePlayers.length > 0) {
          winnerPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)];
          console.log("No survivors — picking random winner:", winnerPlayer);
        } else {
          winnerPlayer = null;
        }
      } else {
        // prepare for next round
        activePlayers = survivors;
        // small pause between rounds visually: spawnIndex reset will be triggered by startRound
        setTimeout(() => {
          startRound();
        }, 600); // 600ms pause between rounds
      }
    }

    // Winner handling: show winner screen and end after frames
    if (winnerPlayer) {
      // overlay winner text
      ctx.fillStyle = "#fff";
      ctx.font = haveFont ? "bold 96px MainFont" : "bold 96px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${winnerPlayer.name || `user${winnerPlayer.id}`} won!`, WIDTH / 2, HEIGHT * 0.42);

      ctx.font = haveFont ? "bold 48px MainFont" : "bold 48px sans-serif";
      ctx.fillText("comment 'ENTER' to participate", WIDTH / 2, HEIGHT * 0.52);
      ctx.fillText("(subscribers get an extra ball)", WIDTH / 2, HEIGHT * 0.58);

      showWinnerFrames++;
      if (showWinnerFrames >= totalWinnerFrames) {
        // end: close stream and interval
        clearInterval(interval);
        try { frameStream.end(); } catch (e) {}
        return;
      }
    }

    // write frame to ffmpeg
    try {
      const png = canvas.toBuffer("image/png");
      frameStream.write(png);
    } catch (e) {
      console.error("Error writing frame:", e);
    }

    frame++;
    if (frame > maxFrames) {
      console.warn("Max frames reached — ending");
      clearInterval(interval);
      try { frameStream.end(); } catch (e) {}
      return;
    }
  }, Math.round(1000 / FPS));
}

render().catch(err => {
  console.error("Renderer error:", err);
  process.exit(1);
});


