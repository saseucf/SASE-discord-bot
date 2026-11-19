import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';

export function buildHackathonMessage(delivery) {
    const event = delivery.content_snapshot;
    const start = Math.floor(Date.parse(event.start_time) / 1000);
    const end = Math.floor(Date.parse(event.end_time) / 1000);
    // Keep the website's RSVP metadata out of the visible description.
    const description = event.description?.split('\n\n===EXTERNAL_URL===')[0];
    const embed = new EmbedBuilder().setColor(0x89ABE3)
        .setTitle(event.title.slice(0, 256))
        .setThumbnail('https://raw.githubusercontent.com/saseucf/saseweb/main/public/logo-hero.png')
        .setDescription((description || 'Join us for this session.').slice(0, 3500))
        .addFields(
            { name: 'Date', value: `<t:${start}:D>`, inline: true },
            { name: 'Location', value: (event.location || 'TBD').slice(0, 1024), inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            { name: 'Start', value: `<t:${start}:t>`, inline: true },
            { name: 'End', value: Number.isFinite(end) ? `<t:${end}:t>` : 'TBD', inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
        )
        .setFooter({ text: 'UCF SASE · Hackathon sessions' });
    // Enable links after the matching website routes are deployed.
    if (process.env.SASE_WEBSITE_URL && /^[0-9a-f-]{36}$/i.test(delivery.event_id ?? '')) {
        const base = new URL(process.env.SASE_WEBSITE_URL);
        if (base.protocol !== 'https:' || base.username || base.password) throw new Error('SASE_WEBSITE_URL must be a public HTTPS URL');
        const url = new URL(`/events/${delivery.event_id}`, base).href;
        embed.setURL(url).addFields({ name: '\u200b', value: `[View event details →](${url})` });
    }
    return {
        content: `# Hackathon Reminder\n<t:${start}:D>\n\n**Starting soon** · starts <t:${start}:R>\ncc: <@&${delivery.role_id_snapshot}>`,
        allowed_mentions: { parse: [], roles: [delivery.role_id_snapshot] },
        embeds: [embed.toJSON()],
    };
}

export function classifyFailure(error) {
    return Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
        ? { state: 'failed', error: `discord_${error.status}` }
        : { state: 'unknown', error: 'discord_delivery_ambiguous' };
}

export function createHackathonWorker({ claim, finish, send, report = console.error, missingConfiguration = async () => [] }) {
    return async () => {
        try {
            const missing = await missingConfiguration();
            if (missing.length) report('Hackathon reminders skipped: configure channel and role for', missing);
            for (let processed = 0; processed < 100; processed++) {
                const delivery = await claim();
                if (!delivery) return;
                let message;
                try {
                    message = await send(delivery.channel_id_snapshot, buildHackathonMessage(delivery));
                } catch (error) {
                    const failure = classifyFailure(error);
                    await finish(delivery.id, failure.state, failure.error);
                    report('Hackathon reminder send failed', delivery.id, failure);
                    continue;
                }
                try {
                    await finish(delivery.id, 'delivered', null, message?.id);
                } catch (error) {
                    // A successful POST with an uncertain database acknowledgement must NEVER be resent.
                    report('Hackathon reminder completion uncertain', delivery.id, error);
                    await finish(delivery.id, 'unknown', 'completion_write_ambiguous');
                }
            }
        } catch (error) {
            // If recording unknown also fails, the lease is quarantined by the next claim.
            report('Hackathon reminder worker failed', error);
        }
    };
}

// A single HTTP attempt: discord.js REST's automatic retries could duplicate an ambiguous POST.
export async function sendHackathonMessage(channelId, body) {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        const error = new Error('Discord rejected reminder');
        error.status = response.status;
        throw error;
    }
    return response.json();
}

export function startHackathonSchedule() {
    if (process.env.HACKATHON_REMINDERS_ENABLED !== 'true') return;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Hackathon reminders require a server-only SUPABASE_SERVICE_ROLE_KEY');
    }
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const rpc = async (name, args) => {
        const { data, error } = await admin.rpc(name, args);
        if (error) throw error;
        return data;
    };
    const worker = createHackathonWorker({
        claim: () => rpc('claim_hackathon_reminder', {}),
        finish: async (id, state, error = null, messageId = null) => {
            const changed = await rpc('finish_hackathon_reminder', {
                p_id: id, p_state: state, p_error: error, p_message_id: messageId,
            });
            if (!changed) throw new Error('Reminder outcome was not recorded; inspect delivery state');
        },
        send: sendHackathonMessage,
        missingConfiguration: async () => {
            const now = new Date();
            const { data, error } = await admin.from('events')
                .select('id,hackathons!inner(discord_channel_id,discord_role_id)')
                .eq('status', 'published').gt('start_time', now.toISOString())
                .lte('start_time', new Date(now.getTime() + 3600000).toISOString());
            if (error) throw error;
            return (data ?? []).filter(e => !e.hackathons.discord_channel_id || !e.hackathons.discord_role_id).map(e => e.id);
        },
    });
    return cron.schedule('* * * * *', worker, { noOverlap: true, timezone: 'America/New_York' });
}
