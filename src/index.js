import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import cron from 'node-cron';
import { definitions, handle } from './commands.js';
import { runPressure, runWeeklyReports } from './reminders.js';

for (const k of ['DISCORD_TOKEN', 'CR_API_TOKEN']) {
  if (!process.env[k]) { console.error(`Variable manquante : ${k} (voir .env.example)`); process.exit(1); }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Connecté : ${c.user.tag}`);
  await c.application.commands.set(definitions);
  let busy1 = false, busy2 = false;
  cron.schedule('*/5 * * * *', async () => {
    if (busy1) return; busy1 = true;
    try { await runPressure(c); } catch (e) { console.error(e); } finally { busy1 = false; }
  });
  cron.schedule('*/30 * * * *', async () => {
    if (busy2) return; busy2 = true;
    try { await runWeeklyReports(c); } catch (e) { console.error(e); } finally { busy2 = false; }
  });
});

client.on(Events.InteractionCreate, async (i) => {
  try { await handle(i); }
  catch (e) {
    console.error(e);
    const msg = `❌ ${e.message}`;
    if (i.deferred || i.replied) i.editReply({ content: msg }).catch(() => {});
    else if (i.isRepliable()) i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
