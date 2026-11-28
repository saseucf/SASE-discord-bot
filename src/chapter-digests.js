import { escapeMarkdown, MessageFlags } from 'discord.js';
import { getReminderWindow } from './reminder-windows.js';

const MESSAGE_LIMIT = 2000;

function eventText(value, limit) {
    const text = value.replace(/\s+/g, ' ').trim().replaceAll('@', '@\u200b');
    const characters = Array.from(text);
    return escapeMarkdown(characters.length > limit ? characters.slice(0, limit).join('') + '…' : text);
}

export function buildDigestMessages(digest, kind, websiteUrl) {
    const role = digest.discord_role_id;
    const heading = kind === 'daily' ? "Today's events" : "Next week's events";
    const contents = [`<@&${role}> **${heading}**`];
    const continuation = `**${heading} (continued)**`;

    for (const event of digest.events) {
        const title = eventText(event.title, 160) || 'Untitled event';
        const location = eventText(event.location ?? '', 180) || 'Location TBD';
        const start = Math.floor(Date.parse(event.start_time) / 1000);
        const url = new URL(`/events/${encodeURIComponent(event.id)}`, websiteUrl).href;
        const line = `**${title}**\n<t:${start}:f> · ${location} · <${url}>`;
        const current = contents.at(-1);

        if (current.length + line.length + 2 > MESSAGE_LIMIT) {
            contents.push(`${continuation}\n\n${line}`);
        } else {
            contents[contents.length - 1] = `${current}\n\n${line}`;
        }
    }

    return contents.map((content, index) => ({
        content,
        allowed_mentions: { parse: [], roles: index === 0 ? [role] : [], users: [], replied_user: false },
        flags: MessageFlags.SuppressEmbeds,
    }));
}

export function createDigestWorker({ destination, claim, finish, validateDestination, send, websiteUrl }) {
    return async (kind, now) => {
        const window = getReminderWindow(kind, now);
        await validateDestination(destination);
        const events = await claim(kind, window);
        if (!events?.length) return;
        const digest = { ...destination, events };
        await send(digest, buildDigestMessages(digest, kind, websiteUrl));
        await finish(kind, window);
    };
}
