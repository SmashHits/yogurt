/**
 * updatePlayers.js
 *
 * Normalizes players.json:
 * - Ensures schema consistency
 * - Applies subscriber bonus (balls = 2)
 * - Ensures non-subs have 1 ball
 */

const fs = require("fs");
const path = require("path");

const PLAYERS_PATH = path.join(__dirname, "../players.json");

function loadJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizePlayer(id, p) {
  return {
    name: p.name || `user_${id}`,
    enteredVia: p.enteredVia || "unknown",
    joinedAt: p.joinedAt || new Date().toISOString(),
    isPublicSub: !!p.isPublicSub,
    balls: p.isPublicSub ? 2 : 1
  };
}

async function main() {
  console.log("🔄 Normalizing players.json…");

  const players = loadJSON(PLAYERS_PATH, {});
  let changed = false;

  for (const [id, player] of Object.entries(players)) {
    const normalized = normalizePlayer(id, player);

    // detect changes
    if (JSON.stringify(players[id]) !== JSON.stringify(normalized)) {
      players[id] = normalized;
      changed = true;
    }
  }

  if (changed) {
    saveJSON(PLAYERS_PATH, players);
    console.log(`✅ Normalized ${Object.keys(players).length} players`);
  } else {
    console.log("ℹ️ No changes needed");
  }
}

main().catch(err => {
  console.error("❌ updatePlayers.js failed:", err);
  process.exit(1);
});
