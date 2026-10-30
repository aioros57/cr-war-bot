const BASE = process.env.CR_API_BASE || 'https://proxy.royaleapi.dev/v1';

export const normTag = (t) =>
  '#' + String(t).trim().toUpperCase().replace(/^#/, '').replace(/O/g, '0');

export async function cr(endpoint) {
  let res;
  try {
    res = await fetch(BASE + endpoint, {
      headers: { Authorization: `Bearer ${process.env.CR_API_TOKEN}` }
    });
  } catch (e) {
    throw new Error(`Réseau : ${e.cause?.code || e.cause?.message || e.message} (URL : ${BASE})`);
  }
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.message || j.reason || ''; } catch {}
    throw new Error(`API Clash Royale ${res.status}${msg ? ' : ' + msg : ''}`);
  }
  return res.json();
}

const enc = encodeURIComponent;
export const getClan = (t) => cr(`/clans/${enc(t)}`);
export const getMembers = (t) => cr(`/clans/${enc(t)}/members`);
export const getRace = (t) => cr(`/clans/${enc(t)}/currentriverrace`);
export const getLog = (t) => cr(`/clans/${enc(t)}/riverracelog?limit=1`);
export const getPlayer = (t) => cr(`/players/${enc(t)}`);

/** État de la guerre en cours : decks utilisés aujourd'hui par chaque membre ACTUEL du clan. */
export async function warStatus(tag) {
  const [race, members] = await Promise.all([getRace(tag), getMembers(tag)]);
  const part = new Map((race.clan.participants || []).map((p) => [p.tag, p]));
  const players = members.items.map((m) => {
    const p = part.get(m.tag) || {};
    const used = p.decksUsedToday || 0;
    return {
      tag: m.tag,
      name: m.name,
      used,
      total: p.decksUsed || 0,
      fame: p.fame || 0,
      remaining: Math.max(0, 4 - used)
    };
  });
  return {
    race,
    name: race.clan.name,
    tag: race.clan.tag,
    periodType: race.periodType,        // training | warDay | colosseum
    periodIndex: race.periodIndex,
    sectionIndex: race.sectionIndex,
    fame: race.clan.fame,
    isWarDay: race.periodType !== 'training',
    players
  };
}
