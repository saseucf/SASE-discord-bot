import 'dotenv/config';
import cron from 'node-cron';
import { setTimeout as delay } from 'node:timers/promises';
import { PermissionFlagsBits } from 'discord.js';
import { createDigestWorker } from './chapter-digests.js';
import { TIME_ZONE } from './reminder-windows.js';
import { createDigestStore } from './supabase.js';

// Never automatically retry a message that Discord might have accepted.
export async function sendDigestMessage(channelId, message, token, request = fetch, wait = delay) {
    for (let attempt = 1; ; attempt++) {
        const response = await request(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(15000),
        });
        if (response.ok) return;
        if (response.status !== 429 || attempt >= 5) {
            throw new Error(`Discord rejected the digest (HTTP ${response.status})`);
        }
        const body = await response.json().catch(() => null);
        const seconds = body?.retry_after ?? response.headers.get('retry-after');
        if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0 || Number(seconds) > 3600) {
            throw new Error('Discord rate limit has no usable retry delay');
        }
        await wait(Math.max(1, Math.ceil(Number(seconds) * 1000)));
    }
}

export async function validateDestination(client, digest) {
    const channel = await client.channels.fetch(digest.discord_channel_id);
    if (!channel?.guild || !channel.isSendable()) {
        throw new Error('Use a Discord server channel that the bot can send to');
    }
    const permissions = channel.permissionsFor(client.user);
    const sendPermission = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, sendPermission])) {
        throw new Error('The bot lacks permission to send to the configured channel');
    }
    const role = await channel.guild.roles.fetch(digest.discord_role_id);
    if (!role || role.id === channel.guild.id) {
        throw new Error('Use a specific role in the same Discord server as the channel');
    }
    if (!role.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
        throw new Error('The bot cannot mention this role in the configured channel');
    }
}

export function registerDigestSchedule(worker, schedule = cron.schedule, report = console.error) {
    const options = { timezone: TIME_ZONE, noOverlap: true };
    const run = (kind) => async ({ date }) => {
        try {
            await worker(kind, date);
        } catch (error) {
            report(`Chapter ${kind} digest job failed`, error);
        }
    };
    return [
        schedule('0 9 * * *', run('daily'), options),
        schedule('0 18 * * 0', run('weekly'), options),
    ];
}

export default function startSchedule(client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SASE_WEBSITE_URL, DISCORD_TOKEN } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SASE_WEBSITE_URL || !DISCORD_TOKEN) {
        console.error('Chapter digests require SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SASE_WEBSITE_URL and DISCORD_TOKEN');
        return;
    }

    const websiteUrl = URL.canParse(SASE_WEBSITE_URL) ? new URL(SASE_WEBSITE_URL) : null;
    if (!websiteUrl || websiteUrl.protocol !== 'https:' || websiteUrl.username || websiteUrl.password || websiteUrl.origin.length > 250) {
        console.error('SASE_WEBSITE_URL must be the public HTTPS origin of the chapter website');
        return;
    }

    const worker = createDigestWorker({
        ...createDigestStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
        websiteUrl,
        validateDestination: group => validateDestination(client, group),
        send: async (digest, messages) => {
            for (const message of messages) {
                await sendDigestMessage(digest.discord_channel_id, message, DISCORD_TOKEN);
            }
        },
    });
    return registerDigestSchedule(worker);
}
