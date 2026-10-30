import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('data/db.json');
let db = { guilds: {}, sent: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
db.guilds ??= {};
db.sent ??= {};

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

export function guild(id) {
  db.guilds[id] ??= {
    clans: {},   // { '#TAG': { name, channelId, lastReport } }
    links: {},   // { '#PLAYERTAG': discordUserId }
    pressure: { enabled: true, thresholds: [6, 3, 1] } // heures avant le reset
  };
  return db.guilds[id];
}

export const allGuilds = () => Object.entries(db.guilds);
export const wasSent = (k) => !!db.sent[k];

export function markSent(key) {
  db.sent[key] = Date.now();
  const keys = Object.keys(db.sent);
  if (keys.length > 1000) for (const k of keys.slice(0, keys.length - 1000)) delete db.sent[k];
  save();
}
