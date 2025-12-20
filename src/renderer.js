// src/renderer.js
// Round-based pachinko renderer with side-survivor logic.
// Replaces previous renderer; writes output/video.mp4

const fs = require("fs");
const path = require("path");
const { createCanvas, registerFont, loadImage } = require("canvas");
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
const FPS = 30;
const INTRO_TIME = 5;
const WINNER_TIME = 4;
const BALL_SPAWN_INTERVAL_MS = 80;
const DEFAULT_ENTRANTS = 60;
const PEG_ROWS = 12;
const PEG_SPACING_X = 80;
const PEG_SPACING_Y = 120;
const PEG_RADIUS = 8;
const BALL_RADIUS = 14;
const GRAVITY = 0.32;
const STEPS_PER_FRAME = 4;

const OUT_DIR = path.resolve(__dirname, "../output");
const OUTPUT_FILE = path.join(OUT_DIR, "video.mp4");
const FONT_PATH = path.resolve(__dirname, "../assets/font.ttf");
const MUSIC_PATH = path.resolve(__dirname, "../assets/music/song.mp3");
const PLAYERS_PATH = path.resolve(__dirname, "../players.json");

const pfpImages = {};

// -------------------
// Load PFP images
// -------------------
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
      console.warn("Failed to load PFP:", p.id, e.message);
    }
  }
}

// -------------------
// Load font
// -------------------
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

// -------------------
// Load players
// -------------------
function loadPlayers() {
  if (!fs.existsSync(PLAYERS_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(PLAYERS_PATH, "utf8"));
  return Object.entries(raw).map(([id, data]) => ({
    id,
    name: data.name,
    balls: data.balls || 1,
  }));
}

// -------------------
// Peg grid
// -------------------
function makePegGrid() {
  const pegs = [];
  const BASE_COLS = 12;
  const WALL_PADDING = 70;
  const usableWidth = WIDTH - WALL_PADDING * 2;
  const spacingX = usableWidth / (BASE_COLS - 1);

  for (let row = 0; row < PEG_ROWS; row++) {
    const y = 250 + row * PEG_SPACING_Y;
    const isEven = row % 2 === 0;
    const colsThisRow = isEven ? 12 : 11;
    const baseOffset = WALL_PADDING + (isEven ? 0 : spacingX / 2);
    for (let col = 0; col < colsThisRow; col++) {
      let x = baseOffset + col * spacingX;
      x += (col % 2) * 1.5; // micro jitter
      pegs.push({ x, y });
    }
  }
  return pegs;
}

// -------------------
// Ball factory
// -------------------
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

// -------------------
// Ball physics
// -------------------
function updateBall(ball, pegs) {
  ball.vy += GRAVITY;
  ball.vx += (Math.random() * 0.4 - 0.2);
  ball.vy = Math.min(ball.vy, 18);
  ball.vx = Math.max(Math.min(ball.vx, 6), -6);

  ball.x += ball.vx;
  ball.y += ball.vy;

  const left = BALL_RADIUS;
  const right = WIDTH - BALL_RADIUS;

  if (ball.x < left) { ball.x = left; ball.vx = Math.abs(ball.vx) * 0.45; }
  if (ball.x > right) { ball.x = right; ball.vx = -Math.abs(ball.vx) * 0.45; }

  for (const p of pegs) {
    const dx = ball.x - p.x;
    const dy = ball.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = BALL_RADIUS + PEG_RADIUS;
    if (dist < minDist) {
      const angle = Math.atan2(dy, dx);
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      const overlap = minDist - dist;
      ball.x += nx * overlap * 0.8;
      ball.y += ny * overlap * 0.8;
      let speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      speed *= 0.55;
      const randomness = 0.6 + Math.random() * 0.5;
      ball.vx = nx * speed * randomness;
      ball.vy = ny * speed * randomness;
      ball.vx = Math.max(Math.min(ball.vx, 6), -6);
      ball.vy = Math.min(ball.vy, 18);
    }
  }
}

// -------------------
// Bin calculation
// -------------------
function getBinIndex(x, binCount) {
  const w = WIDTH / binCount;
  let idx = Math.floor(x / w);
  idx = Math.max(0, Math.min(idx, binCount - 1));
  return idx;
}

// -------------------
// Main renderer
// -------------------
async function render() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);

  const rawPlayers = JSON.parse(fs.readFileSync(PLAYERS_PATH, "utf8"));
  let activePlayers = Object.entries(rawPlayers).map(([id, p]) => ({
    id,
    name: p.name,
    totalBalls: p.balls,
    currentBalls: p.balls,
  }));

  if (activePlayers.length === 0) {
    for (let i = 0; i < DEFAULT_ENTRANTS; i++) {
      activePlayers.push({ id: `P${i}`, name: `P${i}`, totalBalls: 1, currentBalls: 1 });
    }
  }

  await loadPFPs(activePlayers);
  console.log("Loaded players:", activePlayers.length);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const pegs = makePegGrid();
  const binCount = PEG_ROWS + 1;
  const binWidth = WIDTH / binCount;
  const edgeBins = 2;

  const frameStream = new PassThrough();
  const command = ffmpeg().addInput(frameStream).inputFormat("image2pipe").inputFPS(FPS);

  if (fs.existsSync(MUSIC_PATH)) command.addInput(MUSIC_PATH);

  command.videoCodec("libx264").size(`${WIDTH}x${HEIGHT}`)
    .outputOptions([`-r ${FPS}`, "-pix_fmt yuv420p", "-movflags +faststart", "-shortest"])
    .output(OUTPUT_FILE)
    .on("start", cmd => console.log("FFmpeg started:", cmd.split(" ").slice(0, 6).join(" ") + " ..."))
    .on("progress", p => { if (p.frames) process.stdout.write(`\rframes:${p.frames}`); })
    .on("end", () => console.log("\nFFmpeg finished."))
    .on("error", err => { console.error("FFmpeg error:", err); process.exit(1); })
    .run();

  // --------
  // Round state
  // --------
  let round = 0;
  let spawning = false;
  let spawnTimer = 0;
  let spawnIndex = 0;
  let pendingBalls = [];
  let nextRoundPlayers = [];
  let winnerPlayer = null;
  let showWinnerFrames = 0;

  const totalIntroFrames = INTRO_TIME * FPS;
  const totalWinnerFrames = WINNER_TIME * FPS;
  let frame = 0;
  const maxFrames = 60 * FPS;

  function startRound() {
    round++;
    spawnIndex = 0;
    pendingBalls = [];
    nextRoundPlayers = [];

    // Carry over surviving balls
    activePlayers.forEach(p => {
      if (!p.currentBalls || p.currentBalls <= 0) p.currentBalls = 0;
    });

    spawning = true;
    spawnTimer = 0;
    console.log(`--- START ROUND ${round} — players: ${activePlayers.length} ---`);
  }

  startRound();

  function spawnBallForPlayer(player) {
    if (player.currentBalls <= 0) return;
    const ball = makeBall(player.id);
    pendingBalls.push({ player, ball });
    player.currentBalls--;
  }

  // --------
  // Frame loop
  // --------
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

    // Draw zones
    ctx.fillStyle = "rgba(0,120,0,0.08)";
    ctx.fillRect(0, HEIGHT - 220, edgeBins * binWidth, 220);
    ctx.fillRect(WIDTH - edgeBins * binWidth, HEIGHT - 220, edgeBins * binWidth, 220);

    ctx.fillStyle = "rgba(180,20,20,0.08)";
    ctx.fillRect(edgeBins * binWidth, HEIGHT - 220, WIDTH - edgeBins * 2 * binWidth, 220);

    // Spawn balls
    if (spawning && spawnIndex < activePlayers.length) {
      spawnTimer += intervalMs;
      while (spawnTimer >= spawnIntervalMs && spawnIndex < activePlayers.length) {
        spawnBallForPlayer(activePlayers[spawnIndex]);
        spawnIndex++;
        spawnTimer -= spawnIntervalMs;
      }
    }

    // Physics
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      for (const entry of pendingBalls) updateBall(entry.ball, pegs);
    }

    // Draw balls and check landings
    for (let i = pendingBalls.length - 1; i >= 0; i--) {
      const entry = pendingBalls[i];
      const b = entry.ball;
      const player = entry.player;

      if (pfpImages[player.id]) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(pfpImages[player.id], b.x - BALL_RADIUS, b.y - BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#56bfff";
        ctx.fill();
      }

      // Check landing
      if (b.y > HEIGHT - 120) {
        const bin = getBinIndex(b.x, binCount);
        const isSide = (bin < edgeBins) || (bin >= binCount - edgeBins);
        if (isSide) nextRoundPlayers.push(player);
        pendingBalls.splice(i, 1);
      }
    }

    // HUD
    ctx.fillStyle = "#fff";
    ctx.font = haveFont ? "bold 42px MainFont" : "bold 42px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Round ${round}`, 40, 60);
    ctx.fillText(`Active: ${activePlayers.length}`, 40, 110);
    ctx.textAlign = "center";

    // Intro text
    if (frame < totalIntroFrames) {
      ctx.fillStyle = "#fff";
      ctx.font = haveFont ? "bold 72px MainFont" : "bold 72px sans-serif";
      ctx.fillText(`Day #${DAY_NUMBER} of making my viewers`, WIDTH / 2, HEIGHT * 0.22);
      ctx.fillText("compete against each other.", WIDTH / 2, HEIGHT * 0.30);
    }

    // Round complete
    if (spawning && spawnIndex >= activePlayers.length && pendingBalls.length === 0) {
      spawning = false;

      // Deduplicate survivors
      const survivorsById = {};
      nextRoundPlayers.forEach(p => { survivorsById[p.id] = p; });
      const survivors = Object.values(survivorsById);

      console.log(`Round ${round} complete. Survivors: ${survivors.length}`);

      if (survivors.length === 1) {
        winnerPlayer = survivors[0];
        showWinnerFrames = 0;
        console.log("WINNER:", winnerPlayer);
      } else if (survivors.length === 0) {
        winnerPlayer = activePlayers.length ? activePlayers[Math.floor(Math.random() * activePlayers.length)] : null;
        console.log("No survivors — picking random winner:", winnerPlayer);
      } else {
        activePlayers = survivors.map(p => ({ ...p, currentBalls: p.currentBalls || 1 }));
        setTimeout(() => startRound(), 600);
      }
    }

    // Winner screen
    if (winnerPlayer) {
      ctx.fillStyle = "#fff";
      ctx.font = haveFont ? "bold 96px MainFont" : "bold 96px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${winnerPlayer.name || `user${winnerPlayer.id}`} won!`, WIDTH / 2, HEIGHT * 0.42);

      ctx.font = haveFont ? "bold 48px MainFont" : "bold 48px sans-serif";
      ctx.fillText("comment 'ENTER' to participate", WIDTH / 2, HEIGHT * 0.52);
      ctx.fillText("(subscribers get an extra ball)", WIDTH / 2, HEIGHT * 0.58);

      showWinnerFrames++;
      if (showWinnerFrames >= totalWinnerFrames) {
        clearInterval(interval);
        frameStream.end();
        return;
      }
    }

    // Write frame
    try {
      frameStream.write(canvas.toBuffer("image/png"));
    } catch (e) {
      console.error("Error writing frame:", e);
    }

    frame++;
    if (frame > maxFrames) {
      console.warn("Max frames reached — ending");
      clearInterval(interval);
      frameStream.end();
      return;
    }
  }, intervalMs);
}

render().catch(err => {
  console.error("Renderer error:", err);
  process.exit(1);
});
