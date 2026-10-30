import { EmbedBuilder } from 'discord.js';
import { warStatus, getLog } from './api.js';
import { allGuilds, save, markSent, wasSent } from './store.js';

const RH = Number(process.env.RESET_HOUR_UTC ?? 10);
const RM = Number(process.env.RESET_MINUTE_UTC ?? 0);

export function hoursUntilReset(now = new Date()) {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RH, RM));
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return (t - now) / 36e5;
}

export const fmtDuration = (h) =>
  `${Math.floor(h)}h${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

/** Niveau de "pression" : plus on approche du reset, plus c'est rouge. */
function level(h) {
  if (h <= 1) return { emoji: '🔴', label: 'URGENT', color: 0xe74c3c };
  if (h <= 3) return { emoji: '🟠', label: 'Pression', color: 0xe67e22 };
  return { emoji: '🟡', label: 'Rappel', color: 0xf1c40f };
}

function chunk(lines, max = 1000) {
  const out = []; let cur = '';
  for (const l of lines) {
    if ((cur + '\n' + l).length > max) { out.push(cur); cur = l; }
    else cur = cur ? cur + '\n' + l : l;
  }
  if (cur) out.push(cur);
  return out;
}

function addList(embed, title, lines) {
  if (!lines.length) return;
  chunk(lines).forEach((c, i) => embed.addFields({ name: i ? '\u200b' : title, value: c }));
}

const byName = (a, b) => a.name.localeCompare(b.name);
const dayLabel = (st) => {
  if (st.periodType === 'training') return '😴 Jour d’entraînement';
  const n = (st.periodIndex % 7) - 2;
  const base = st.periodType === 'colosseum' ? '🏟️ Colisée' : '⚔️ Jour de guerre';
  return n >= 1 && n <= 4 ? `${base} ${n}/4` : base;
};

export function statusEmbed(st, g, { color = 0x3498db, title } = {}) {
  const e = new EmbedBuilder().setColor(color).setTitle(title || `${st.name}`);
  const h = hoursUntilReset();
  if (!st.isWarDay) {
    return e.setDescription(`${dayLabel(st)} — pas de combats de guerre aujourd’hui.`)
            .setFooter({ text: st.tag });
  }
  const todo = st.players.filter((p) => p.remaining > 0);
  const zero = todo.filter((p) => p.used === 0).sort(byName);
  const partial = todo.filter((p) => p.used > 0).sort((a, b) => a.used - b.used || byName(a, b));
  const left = todo.reduce((s, p) => s + p.remaining, 0);

  e.setDescription(
    `${dayLabel(st)} · fin dans **${fmtDuration(h)}**\n` +
    (left === 0
      ? '✅ Tous les decks de guerre ont été utilisés !'
      : `**${left}** decks restants · **${todo.length}** joueur(s) n’ont pas fini`)
  );
  addList(e, `❌ Aucun combat (${zero.length})`, zero.map((p) => `• ${p.name} — 0/4`));
  addList(e, `⚠️ Combats incomplets (${partial.length})`, partial.map((p) => `• ${p.name} — ${p.used}/4`));
  return e.setFooter({ text: `${st.tag} · Fame : ${st.fame}` });
}

export function buildReminder(st, g, hoursLeft, th = hoursLeft) {
  const lv = level(th);
  const todo = st.players.filter((p) => p.remaining > 0);
  const ids = new Set();
  for (const p of todo) if (g.links[p.tag]) ids.add(g.links[p.tag]);
  const e = statusEmbed(st, g, { color: lv.color, title: `${lv.emoji} ${lv.label} — ${st.name}` });
  return {
    content: `${lv.emoji} **${lv.label}** : il reste **${fmtDuration(hoursLeft)}** pour utiliser vos decks de guerre !` +
             (ids.size ? '\n' + [...ids].map((i) => `<@${i}>`).join(' ') : ''),
    embeds: [e],
    allowedMentions: { users: [...ids] }
  };
}

/** Rappels progressifs : un message par seuil (ex. 6h, 3h, 1h avant le reset), pour chaque clan. */
export async function runPressure(client) {
  const hoursLeft = hoursUntilReset();
  for (const [gid, g] of allGuilds()) {
    if (!g.pressure.enabled) continue;
    const crossed = g.pressure.thresholds.filter((t) => hoursLeft <= t);
    if (!crossed.length) continue;
    const th = Math.min(...crossed);
    for (const [tag, c] of Object.entries(g.clans)) {
      try {
        const st = await warStatus(tag);
        if (!st.isWarDay) continue;
        const key = (t) => `p:${gid}:${tag}:${st.periodIndex}:${t}`;
        if (wasSent(key(th))) continue;
        crossed.forEach((t) => markSent(key(t)));
        if (!st.players.some((p) => p.remaining > 0)) continue;
        const ch = await client.channels.fetch(c.channelId);
        await ch.send(buildReminder(st, g, hoursLeft, th));
      } catch (err) {
        console.error(`[pression] ${tag}:`, err.message);
      }
    }
  }
}

/* ---------- Rapport de fin de guerre ---------- */
const MAX_DECKS = 16;
const medal = (r) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[r] || '🏁');

export function reportEmbed(tag, item) {
  const st = item.standings.find((s) => s.clan.tag === tag);
  if (!st) return null;
  const c = st.clan;
  const rows = (c.participants || []).map((p) => ({
    name: p.name, used: p.decksUsed || 0, fame: p.fame || 0
  }));
  const total = rows.reduce((s, r) => s + r.used, 0);
  const zero = rows.filter((r) => r.used === 0).sort(byName);
  const missing = rows.filter((r) => r.used > 0 && r.used < MAX_DECKS)
                      .sort((a, b) => a.used - b.used || byName(a, b));
  const top = [...rows].sort((a, b) => b.fame - a.fame).slice(0, 3);

  const e = new EmbedBuilder()
    .setColor(st.rank === 1 ? 0xf1c40f : 0x3498db)
    .setTitle(`📊 Rapport de guerre — ${c.name}`)
    .setDescription(
      `Saison ${item.seasonId} · Semaine ${item.sectionIndex + 1}\n` +
      `${medal(st.rank)} Classement : **#${st.rank}** · Fame : **${c.fame}**\n` +
      `Decks utilisés : **${total}** · Decks non joués : **${Math.max(0, rows.length * MAX_DECKS - total)}**`
    );
  addList(e, '🏆 Top fame', top.map((r, i) => `${i + 1}. ${r.name} — ${r.fame}`));
  addList(e, `❌ Aucun combat (${zero.length})`, zero.map((r) => `• ${r.name}`));
  addList(e, `⚠️ Decks non utilisés (${missing.length})`,
    missing.map((r) => `• ${r.name} — ${r.used}/${MAX_DECKS} (−${MAX_DECKS - r.used})`));
  return e.setFooter({ text: tag }).setTimestamp();
}

/** Poste automatiquement le rapport dès qu'une nouvelle guerre apparaît dans l'historique. */
export async function runWeeklyReports(client) {
  for (const [, g] of allGuilds()) {
    for (const [tag, c] of Object.entries(g.clans)) {
      try {
        const log = await getLog(tag);
        const item = log.items?.[0];
        if (!item) continue;
        const id = `${item.seasonId}-${item.sectionIndex}`;
        if (c.lastReport === id) continue;
        const first = c.lastReport === undefined;
        c.lastReport = id; save();
        if (first) continue;
        const emb = reportEmbed(tag, item);
        if (!emb) continue;
        const ch = await client.channels.fetch(c.channelId);
        await ch.send({ embeds: [emb] });
      } catch (err) {
        console.error(`[rapport] ${tag}:`, err.message);
      }
    }
  }
}

/* ---------- Tension de la course ---------- */
export function tensionEmbed(st) {
  const race = st.race;
  const clans = (race.clans?.length ? race.clans : [race.clan]).map((c) => ({
    tag: c.tag,
    name: c.name,
    score: (c.fame || 0) + (c.repairPoints || 0),
    today: (c.participants || []).reduce((s, p) => s + (p.decksUsedToday || 0), 0),
    finishTime: c.finishTime || null
  })).sort((a, b) => {
    if (a.finishTime && b.finishTime) return a.finishTime.localeCompare(b.finishTime);
    if (a.finishTime) return -1;
    if (b.finishTime) return 1;
    return b.score - a.score;
  });

  const idx = clans.findIndex((c) => c.tag === st.tag);
  const me = clans[idx];
  const above = clans[idx - 1];
  const below = clans[idx + 1];

  const ourDecks = (race.clan.participants || []).reduce((s, p) => s + (p.decksUsed || 0), 0);
  const avg = ourDecks > 0 ? (race.clan.fame || 0) / ourDecks : 150;
  const left = st.isWarDay ? st.players.reduce((s, p) => s + p.remaining, 0) : 0;
  const potential = Math.round(left * avg);

  const gapUp = above ? above.score - me.score : null;
  const gapDown = below ? me.score - below.score : null;
  const closest = Math.min(gapUp ?? Infinity, gapDown ?? Infinity);
  const ref = Math.max(potential, avg * 20);

  let lv = { emoji: '🟢', label: 'Confortable', color: 0x2ecc71 };
  if (closest <= ref * 0.5) lv = { emoji: '🔴', label: 'Très tendu', color: 0xe74c3c };
  else if (closest <= ref * 1.5) lv = { emoji: '🟠', label: 'Serré', color: 0xe67e22 };
  if (closest === Infinity) lv = { emoji: '🟢', label: 'Seul en course', color: 0x2ecc71 };

  const rank = clans.map((c, i) => {
    const mine = c.tag === st.tag;
    const diff = mine ? 'toi' : `${c.score - me.score >= 0 ? '+' : ''}${c.score - me.score}`;
    const fin = c.finishTime ? ' 🏁' : '';
    return `${medal(i + 1)} ${mine ? `**${c.name}**` : c.name}${fin} — ${c.score} pts (${diff}) · ${c.today} decks joués aujourd’hui`;
  });

  const e = new EmbedBuilder()
    .setColor(lv.color)
    .setTitle(`${lv.emoji} Tension — ${st.name}`)
    .setDescription(`**${lv.label}** · ${dayLabel(st)} · reset dans **${fmtDuration(hoursUntilReset())}**`)
    .addFields({ name: 'Classement de la course', value: rank.join('\n').slice(0, 1024) });

  const info = [];
  if (st.isWarDay) {
    info.push(`Decks restants : **${left}** (≈ **${potential}** pts avec ~${Math.round(avg)} pts/deck)`);
  }
  if (above) {
    info.push(`⬆️ ${above.name} : **${gapUp}** pts devant` +
      (st.isWarDay && potential >= gapUp ? ' — 💥 tu peux les dépasser aujourd’hui !' : ''));
  }
  if (below) {
    info.push(`⬇️ ${below.name} : **${gapDown}** pts derrière` +
      (gapDown <= ref ? ' — ⚠️ ils peuvent te rattraper' : ''));
  }
  e.addFields({ name: 'Ton clan', value: info.join('\n') || 'Pas assez de données.' });
  return e.setFooter({ text: 'Estimation basée sur ta moyenne de points par deck' });
}
