import 'dotenv/config';
import remindEvent, {markReminded, getWeeklyEvents} from "./supabase.js";
import { EmbedBuilder } from 'discord.js';
import cron from 'node-cron';

function buildEventEmbed(event) {
    const unix = Math.floor(new Date(event.start_time).getTime() / 1000);
    const endUnix = Math.floor(new Date(event.end_time).getTime() / 1000);
    return new EmbedBuilder()
        .setColor(0x171C4A)
        .setAuthor({ name: event.event_type })
        .setTitle(event.title)
        .setDescription(event.description ?? '')
        .addFields(
            { name: 'Date', value: new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), inline: true },
            { name: 'Location', value: event.location ?? 'TBD', inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            { name: 'Start', value: `<t:${unix}:t>`, inline: true },
            { name: 'End', value: `<t:${endUnix}:t>`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
        );
}

export default function startSchedule(Client) {
    cron.schedule('*/15 * * * *', async () => {
        let events = await remindEvent();
        const channel = await Client.channels.fetch(process.env.CHANNEL_ID);
        for (const event of events) {
            await channel.send({content: '@everyone', embeds: [buildEventEmbed(event)]});
            await markReminded(event.id);
        }
    });

    cron.schedule('0 9 * * 1', async () => {
        let events = await getWeeklyEvents();
        const channel = await Client.channels.fetch(process.env.CHANNEL_ID);
        await channel.send('@everyone Check out what\'s happening this week!');
        for (const event of events) {
            await channel.send({embeds: [buildEventEmbed(event)]});
        }
    });
};
