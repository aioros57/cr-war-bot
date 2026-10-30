import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { guild, save } from './store.js';
import { normTag, getClan, getLog, getPlayer, warStatus } from './api.js';
import { statusEmbed, reportEmbed, buildReminder, hoursUntilReset, tensionEmbed } from './reminders.js';

const ADMIN = PermissionFlagsBits.ManageGuild;
const clanOpt = (o) => o.setName('clan').setDescription('Clan (tous si vide)').setAutocomplete(true);

export const definitions = [
  new SlashCommandBuilder().setName('clan').setDescription('Gérer les clans suivis')
    .setDefaultMemberPermissions(ADMIN).setDMPermission(false)
    .addSubcommand((s) => s.setName('ajouter').setDescription('Suivre un clan')
      .addStringOption((o) => o.setName('tag').setDescription('Tag du clan (#ABC123)').setRequired(true))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon des rappels et rapports')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('retirer').setDescription('Ne plus suivre un clan')
      .addStringOption((o) => clanOpt(o).setRequired(true)))
    .addSubcommand((s) => s.setName('liste').setDescription('Lister les clans suivis')),

  new SlashCommandBuilder().setName('guerre').setDescription('Guerre de clans en cours')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('statut').setDescription('Joueurs qui n’ont pas utilisé leurs decks aujourd’hui')
      .addStringOption(clanOpt))
    .addSubcommand((s) => s.setName('rapport').setDescription('Rapport de la dernière guerre terminée')
      .addStringOption(clanOpt))
    .addSubcommand((s) => s.setName('rappel').setDescription('Envoyer un rappel maintenant (ping les joueurs liés)')
      .addStringOption(clanOpt)),

  new SlashCommandBuilder().setName('tension').setDescription('Tension de la course : classement, écarts et dépassements possibles')
    .setDMPermission(false)
    .addStringOption(clanOpt),

  new SlashCommandBuilder().setName('lier').setDescription('Lier un compte Clash Royale à un membre Discord (pour les pings)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('tag').setDescription('Tag du joueur (#ABC123)').setRequired(true))
    .addUserOption((o) => o.setName('membre').setDescription('Membre Discord (toi par défaut)')),

  new SlashCommandBuilder().setName('delier').setDescription('Supprimer un lien joueur ↔ Discord')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('tag').setDescription('Tag du joueur').setRequired(true)),

  new SlashCommandBuilder().setName('pression').setDescription('Configurer les rappels progressifs')
    .setDefaultMemberPermissions(ADMIN).setDMPermission(false)
    .addBooleanOption((o) => o.setName('actif').setDescription('Activer / désactiver'))
    .addStringOption((o) => o.setName('seuils').setDescription('Heures avant le reset, ex : 6,3,1'))
].map((c) => c.toJSON());

const eph = { flags: MessageFlags.Ephemeral };

function pick(g, tag) {
  if (tag) { const t = normTag(tag); return g.clans[t] ? [[t, g.clans[t]]] : []; }
  return Object.entries(g.clans);
}

async function autocomplete(i) {
  const g = guild(i.guildId);
  const q = i.options.getFocused().toLowerCase();
  const list = Object.entries(g.clans)
    .map(([t, c]) => ({ name: `${c.name} (${t})`, value: t }))
    .filter((c) => c.name.toLowerCase().includes(q)).slice(0, 25);
  await i.respond(list);
}

export async function handle(i) {
  if (i.isAutocomplete()) return autocomplete(i);
  if (!i.isChatInputCommand()) return;
  const g = guild(i.guildId);
  const isAdmin = i.memberPermissions?.has(ADMIN);

  if (i.commandName === 'clan') {
    const sub = i.options.getSubcommand();
    if (sub === 'ajouter') {
      await i.deferReply(eph);
      const tag = normTag(i.options.getString('tag', true));
      const ch = i.options.getChannel('salon', true);
      const info = await getClan(tag);
      g.clans[tag] = { name: info.name, channelId: ch.id };
      try {
        const item = (await getLog(tag)).items?.[0];
        if (item) g.clans[tag].lastReport = `${item.seasonId}-${item.sectionIndex}`;
      } catch {}
      save();
      return i.editReply(`✅ **${info.name}** (${tag}) est suivi. Rappels et rapports → ${ch}.`);
    }
    if (sub === 'retirer') {
      const tag = normTag(i.options.getString('clan', true));
      if (!g.clans[tag]) return i.reply({ content: 'Clan non suivi.', ...eph });
      const name = g.clans[tag].name; delete g.clans[tag]; save();
      return i.reply({ content: `🗑️ ${name} retiré.`, ...eph });
    }
    const lines = Object.entries(g.clans).map(([t, c]) => `• **${c.name}** (${t}) → <#${c.channelId}>`);
    return i.reply({ content: lines.join('\n') || 'Aucun clan suivi. Utilise `/clan ajouter`.', ...eph });
  }

  if (i.commandName === 'guerre') {
    const sub = i.options.getSubcommand();
    const clans = pick(g, i.options.getString('clan'));
    if (!clans.length) return i.reply({ content: 'Aucun clan trouvé. Utilise `/clan ajouter`.', ...eph });

    if (sub === 'rappel' && !isAdmin)
      return i.reply({ content: '⛔ Réservé aux gestionnaires du serveur.', ...eph });

    await i.deferReply();
    const embeds = [], contents = [];
    for (const [tag, c] of clans.slice(0, 10)) {
      try {
        if (sub === 'rapport') {
          const item = (await getLog(tag)).items?.[0];
          const e = item && reportEmbed(tag, item);
          if (e) embeds.push(e); else contents.push(`${c.name} : aucun rapport disponible.`);
        } else {
          const st = await warStatus(tag);
          if (sub === 'statut') embeds.push(statusEmbed(st, g, { title: `${st.name}` }));
          else {
            if (!st.isWarDay) { contents.push(`${st.name} : jour d’entraînement.`); continue; }
            const r = buildReminder(st, g, hoursUntilReset());
            contents.push(r.content); embeds.push(...r.embeds);
          }
        }
      } catch (err) { contents.push(`❌ ${c.name} : ${err.message}`); }
    }
    const allowed = [...new Set(Object.values(g.links))];
    return i.editReply({
      content: contents.join('\n') || undefined, embeds,
      allowedMentions: sub === 'rappel' ? { users: allowed } : { parse: [] }
    });
  }

  if (i.commandName === 'tension') {
    const clans = pick(g, i.options.getString('clan'));
    if (!clans.length) return i.reply({ content: 'Aucun clan trouvé. Utilise `/clan ajouter`.', ...eph });
    await i.deferReply();
    const embeds = [], errors = [];
    for (const [tag, c] of clans.slice(0, 10)) {
      try { embeds.push(tensionEmbed(await warStatus(tag))); }
      catch (err) { errors.push(`❌ ${c.name} : ${err.message}`); }
    }
    return i.editReply({ content: errors.join('\n') || undefined, embeds, allowedMentions: { parse: [] } });
  }

  if (i.commandName === 'lier') {
    await i.deferReply(eph);
    const target = i.options.getUser('membre') ?? i.user;
    if (target.id !== i.user.id && !isAdmin)
      return i.editReply('⛔ Seuls les gestionnaires peuvent lier un autre membre.');
    const tag = normTag(i.options.getString('tag', true));
    const p = await getPlayer(tag);
    g.links[tag] = target.id; save();
    return i.editReply(`🔗 **${p.name}** (${tag}) ↔ ${target}`);
  }

  if (i.commandName === 'delier') {
    const tag = normTag(i.options.getString('tag', true));
    if (g.links[tag] !== i.user.id && !isAdmin)
      return i.reply({ content: '⛔ Ce lien ne t’appartient pas.', ...eph });
    delete g.links[tag]; save();
    return i.reply({ content: '✅ Lien supprimé.', ...eph });
  }

  if (i.commandName === 'pression') {
    const actif = i.options.getBoolean('actif');
    const raw = i.options.getString('seuils');
    if (actif !== null) g.pressure.enabled = actif;
    if (raw) {
      const t = [...new Set(raw.split(/[\s,;]+/).map(Number).filter((n) => n > 0 && n <= 24))].sort((a, b) => b - a);
      if (!t.length) return i.reply({ content: 'Seuils invalides (ex : `6,3,1`).', ...eph });
      g.pressure.thresholds = t;
    }
    save();
    return i.reply({
      content: `Rappels progressifs : **${g.pressure.enabled ? 'activés' : 'désactivés'}** — ` +
               `seuils : ${g.pressure.thresholds.map((h) => h + 'h').join(' → ')} avant le reset (10:00 UTC).`,
      ...eph
    });
  }
}
