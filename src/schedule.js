import 'dotenv/config';
import { getReminderEvents } from './supabase.js';
import { TIME_ZONE } from './reminder-windows.js';
import { EmbedBuilder } from 'discord.js';
import cron from 'node-cron';
import { startHackathonSchedule } from './hackathon-reminders.js';

export function buildEventEmbed(event) {
    const unix = Math.floor(new Date(event.start_time).getTime() / 1000);
    const endUnix = Math.floor(new Date(event.end_time).getTime() / 1000);
    return new EmbedBuilder()
        .setColor(0x171C4A)
        .setAuthor({ name: event.event_type })
        .setTitle(event.title)
        .setDescription(event.description ?? '')
        .addFields(
            { name: 'Date', value: new Date(event.start_time).toLocaleDateString('en-US', { timeZone: TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), inline: true },
            { name: 'Location', value: event.location ?? 'TBD', inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            { name: 'Start', value: `<t:${unix}:t>`, inline: true },
            { name: 'End', value: `<t:${endUnix}:t>`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
        );
}

export default function startSchedule(Client) {
    async function sendReminder(kind) {
        try {
            const events = await getReminderEvents(kind);
            if (!events.length) return;
            const roleId = process.env.ROLE_ID;
            if (kind === 'daily' && !/^[0-9]{17,20}$/.test(roleId ?? '')) {
                throw new Error('Daily reminders require a valid ROLE_ID');
            }
            const channel = await Client.channels.fetch(process.env.CHANNEL_ID);
            const heading = kind === 'weekly'
                ? '@everyone Check out what\'s happening next week!'
                : `<@&${roleId}> Here's what's happening today!`;
            for (const [index, event] of events.entries()) {
                await channel.send({
                    ...(index === 0 ? { content: heading } : {}),
                    embeds: [buildEventEmbed(event)],
                });
            }
        } catch (error) {
            console.error(`Failed to send ${kind} reminder:`, error);
        }
    }
    const options = { timezone: TIME_ZONE, noOverlap: true };
    cron.schedule('0 9 * * *', () => sendReminder('daily'), options);
    cron.schedule('0 9 * * 0', () => sendReminder('weekly'), options);
    startHackathonSchedule();
};
