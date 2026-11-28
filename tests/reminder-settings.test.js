import assert from 'node:assert/strict';
import test from 'node:test';
import { Collection, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { handleReminderButton } from '../src/reminder-settings.js';
import reminderSettings from '../src/commands/utility/reminder-settings.js';
import interactionCreate from '../src/events/interactionCreate.js';

const guildId = '20000000000000001';
const settingsChannel = '20000000000000002';
const otherChannel = '20000000000000003';
const roleId = '20000000000000004';
const userId = '20000000000000005';
const env = { DISCORD_BOT_SETTINGS_CHANNEL_ID: settingsChannel, DISCORD_REMINDERS_ROLE_ID: roleId };

function isEphemeral(payload) {
    if (typeof payload !== 'object' || payload === null) return false;
    return payload.ephemeral === true || ((Number(payload.flags ?? 0) & MessageFlags.Ephemeral) !== 0);
}

function buttonInteraction({ customId = 'reminder:enable', channelId = settingsChannel, inGuild = true, role = {}, fail = {} } = {}) {
    const log = { added: [], removed: [], fetchedMembers: [], replies: [], deferred: [] };
    const member = {
        id: userId,
        roles: {
            add: async id => { if (fail.add) throw fail.add; log.added.push(id); },
            remove: async id => { log.removed.push(id); },
        },
    };
    const interaction = {
        customId, channelId, guildId: inGuild ? guildId : null,
        user: { id: userId }, member: inGuild ? member : null,
        replied: false, deferred: false,
        isButton: () => true, isChatInputCommand: () => false, inGuild: () => inGuild,
        guild: inGuild ? {
            id: guildId,
            roles: {
                fetch: async id => (id === roleId
                    ? { id, managed: false, editable: true, permissions: { bitfield: 0n }, ...role }
                    : null),
            },
            members: {
                fetch: async id => {
                    log.fetchedMembers.push(id);
                    if (id !== userId) throw new Error('fetched another member');
                    return member;
                },
            },
        } : null,
        deferReply: async payload => {
            if (fail.defer) throw fail.defer;
            log.deferred.push(payload); interaction.deferred = true;
        },
        reply: async payload => { log.replies.push(payload); interaction.replied = true; },
        editReply: async payload => { log.replies.push(payload); },
        followUp: async payload => { log.replies.push(payload); },
    };
    return { interaction, log };
}

function assertPrivateResponse(log) {
    const first = log.deferred[0] ?? log.replies[0];
    assert.ok(isEphemeral(first), 'button responses are ephemeral');
}

test('Enable adds the reminder role to the member who clicked', async () => {
    const { interaction, log } = buttonInteraction();
    await handleReminderButton(interaction, env);
    assert.deepEqual(log.added, [roleId]);
    assert.deepEqual(log.removed, []);
    assert.ok(log.fetchedMembers.every(id => id === userId));
    assertPrivateResponse(log);
    assert.match(String(log.replies.at(-1)?.content ?? log.replies.at(-1)), /enabled/i);
});

test('Disable removes the reminder role from the member who clicked', async () => {
    const { interaction, log } = buttonInteraction({ customId: 'reminder:disable' });
    await handleReminderButton(interaction, env);
    assert.deepEqual(log.removed, [roleId]);
    assert.deepEqual(log.added, []);
    assertPrivateResponse(log);
    assert.match(String(log.replies.at(-1)?.content ?? log.replies.at(-1)), /disabled/i);
});

test('buttons outside the bot settings channel change nothing', async () => {
    const { interaction, log } = buttonInteraction({ channelId: otherChannel });
    await handleReminderButton(interaction, env);
    assert.deepEqual([log.added, log.removed], [[], []]);
});

test('buttons outside a server change nothing', async () => {
    const { interaction, log } = buttonInteraction({ inGuild: false });
    await handleReminderButton(interaction, env);
    assert.deepEqual([log.added, log.removed], [[], []]);
});

test('unrelated buttons are ignored without a response', async () => {
    for (const customId of ['reminder:toggle', 'other:enable', 'reminder:enable:extra', '']) {
        const { interaction, log } = buttonInteraction({ customId });
        await handleReminderButton(interaction, env);
        assert.deepEqual([log.added, log.removed, log.replies, log.deferred], [[], [], [], []], customId);
    }
});

test('missing settings change nothing', async () => {
    for (const partial of [{}, { DISCORD_REMINDERS_ROLE_ID: roleId }, { DISCORD_BOT_SETTINGS_CHANNEL_ID: settingsChannel }]) {
        const { interaction, log } = buttonInteraction();
        await handleReminderButton(interaction, partial);
        assert.deepEqual([log.added, log.removed], [[], []], JSON.stringify(partial));
    }
});

test('only grants a plain role: not @everyone, managed, above the bot, or carrying permissions', async () => {
    const unsafe = [
        { id: guildId },
        { managed: true },
        { editable: false },
        { permissions: { bitfield: PermissionFlagsBits.Administrator } },
        { permissions: { bitfield: PermissionFlagsBits.ManageMessages } },
    ];
    for (const role of unsafe) {
        const { interaction, log } = buttonInteraction({ role });
        const settings = role.id === guildId ? { ...env, DISCORD_REMINDERS_ROLE_ID: guildId } : env;
        if (role.id === guildId) interaction.guild.roles.fetch = async id => ({ id, managed: false, editable: true, permissions: { bitfield: 0n } });
        await handleReminderButton(interaction, settings);
        assert.deepEqual(log.added, [], JSON.stringify(role, (_k, v) => typeof v === 'bigint' ? String(v) : v));
    }
});

test('a Discord error while changing the role gets a private reply instead of throwing', async () => {
    const { interaction, log } = buttonInteraction({ fail: { add: Object.assign(new Error('Missing Permissions'), { code: 50013 }) } });
    const original = console.error;
    console.error = () => {};
    try {
        await handleReminderButton(interaction, env);
    } finally {
        console.error = original;
    }
    assert.ok(log.replies.length > 0);
    assertPrivateResponse(log);
});

test('the interaction event routes reminder buttons using the process environment', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
        const { interaction, log } = buttonInteraction();
        await interactionCreate.execute(interaction);
        assert.deepEqual(log.added, [roleId]);
    } finally {
        for (const key of Object.keys(env)) {
            if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
        }
    }
});

test('an expired button interaction does not reject out of the event handler', async () => {
    // client.on() does not catch async rejections; an unhandled one stops the bot process.
    const { interaction } = buttonInteraction({ fail: { defer: Object.assign(new Error('Unknown interaction'), { code: 10062 }) } });
    const original = console.error;
    console.error = () => {};
    try {
        await assert.doesNotReject(Promise.resolve().then(() => interactionCreate.execute(interaction)));
    } finally {
        console.error = original;
    }
});

function commandInteraction({ admin = true, channelId = settingsChannel, inGuild = true } = {}) {
    const posted = [];
    const channel = { id: channelId, send: async payload => { posted.push({ via: 'channel', payload }); } };
    const interaction = {
        commandName: 'reminder-settings', channelId, channel, guildId: inGuild ? guildId : null,
        user: { id: userId },
        inGuild: () => inGuild,
        memberPermissions: inGuild ? { has: permission => admin && permission === PermissionFlagsBits.Administrator } : null,
        client: { channels: { fetch: async () => channel } },
        replied: false, deferred: false,
        reply: async payload => { posted.push({ via: 'reply', payload }); interaction.replied = true; },
        deferReply: async payload => { posted.push({ via: 'defer', payload }); interaction.deferred = true; },
        editReply: async payload => { posted.push({ via: 'edit', payload }); },
        followUp: async payload => { posted.push({ via: 'followUp', payload }); },
    };
    return { interaction, posted };
}

function buttonIds(posted) {
    return posted.flatMap(({ payload }) => (payload?.components ?? [])
        .map(row => (typeof row.toJSON === 'function' ? row.toJSON() : row))
        .flatMap(row => row.components ?? [])
        .map(component => component.custom_id));
}

test('/reminder-settings is registered as an administrator-only command', () => {
    const json = reminderSettings.data.toJSON();
    assert.equal(json.name, 'reminder-settings');
    assert.equal(json.default_member_permissions, String(PermissionFlagsBits.Administrator));
});

test('/reminder-settings posts the Enable and Disable panel for an admin in the settings channel', async () => {
    const saved = process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID;
    process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID = settingsChannel;
    try {
        const { interaction, posted } = commandInteraction();
        await reminderSettings.execute(interaction);
        assert.deepEqual(buttonIds(posted).sort(), ['reminder:disable', 'reminder:enable']);
        const panel = posted.find(({ payload }) => payload?.components?.length);
        assert.equal(isEphemeral(panel.payload), false, 'members must be able to see the panel');
    } finally {
        if (saved === undefined) delete process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID; else process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID = saved;
    }
});

test('/reminder-settings refuses non-admins, other channels and DMs without posting buttons', async () => {
    const saved = process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID;
    process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID = settingsChannel;
    try {
        for (const options of [{ admin: false }, { channelId: otherChannel }, { inGuild: false }]) {
            const { interaction, posted } = commandInteraction(options);
            await reminderSettings.execute(interaction);
            assert.deepEqual(buttonIds(posted), [], JSON.stringify(options));
            assert.ok(posted.every(({ payload }) => isEphemeral(payload)), JSON.stringify(options));
        }
    } finally {
        if (saved === undefined) delete process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID; else process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID = saved;
    }
});

test('slash commands still dispatch through the interaction event', async () => {
    let ran = 0;
    const interaction = {
        commandName: 'ping', user: { id: userId },
        isButton: () => false, isChatInputCommand: () => true,
        client: {
            commands: new Collection([['ping', { data: { name: 'ping' }, execute: async () => { ran++; } }]]),
            cooldowns: new Collection(),
        },
    };
    await interactionCreate.execute(interaction);
    assert.equal(ran, 1);
});
