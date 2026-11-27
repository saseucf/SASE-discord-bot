import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDigestMessages, createDigestWorker } from '../src/chapter-digests.js';
import { registerDigestSchedule, sendDigestMessage, validateDestination } from '../src/schedule.js';

const websiteUrl = 'https://chapter.example.test';
const role = '10000000000000001';
const channelId = '10000000000000002';
const event = { id: 'event-id', title: 'Study Night', location: 'Library', start_time: '2026-11-30T23:00:00Z' };
const digest = { name: 'Chapter', discord_channel_id: channelId, discord_role_id: role, events: [event] };
const now = new Date('2026-11-29T23:00:00Z');

test('registers the Eastern daily and Sunday jobs using their scheduled instant', async () => {
    const jobs = [];
    const calls = [];
    registerDigestSchedule((...args) => calls.push(args), (...args) => jobs.push(args));
    assert.deepEqual(jobs.map(([expression,, options]) => [expression, options]), [
        ['0 9 * * *', { timezone: 'America/New_York', noOverlap: true }],
        ['0 18 * * 0', { timezone: 'America/New_York', noOverlap: true }],
    ]);
    assert.deepEqual(calls, []);
    for (const [, run] of jobs) await run({ date: now });
    assert.deepEqual(calls, [['daily', now], ['weekly', now]]);
});

test('renders titles, times, locations and public event links in order', () => {
    const [message] = buildDigestMessages({ ...digest, events: [event, { ...event, id: 'second', title: 'Career Night', location: null }] }, 'weekly', websiteUrl);
    assert.match(message.content, /^<@&10000000000000001> \*\*Next week's events/);
    assert.match(message.content, /Study Night\*\*\n<t:\d+:f> .* Library .* <https:\/\/chapter.example.test\/events\/event-id>/);
    assert.match(message.content, /Study Night[\s\S]+Career Night[\s\S]+Location TBD/);
    assert.deepEqual(message.allowed_mentions, { parse: [], roles: [role], users: [], replied_user: false });
});

test('keeps long digests within Discord limits with one role mention and intact event links', () => {
    const events = Array.from({ length: 9 }, (_, index) => ({
        ...event, id: `event-${index}`, title: '**@everyone** '.repeat(100),
        location: `<@&${role}> <@123456789012345678> @here ` + 'x'.repeat(250),
    }));
    const messages = buildDigestMessages({ ...digest, name: '@everyone', events }, 'daily', websiteUrl);
    assert.ok(messages.length > 1);
    assert.ok(messages.every(message => message.content.length <= 2000));
    assert.ok(messages.every(message => message.flags === 4));
    assert.equal(messages.slice(1).every(message => message.allowed_mentions.roles.length === 0), true);
    assert.deepEqual(messages.flatMap(message => message.allowed_mentions.roles), [role]);
    const contents = messages.map(message => message.content).join('\n');
    assert.equal(contents.split(`<@&${role}>`).length - 1, 1);
    assert.doesNotMatch(contents, /@everyone|@here|<@123456789012345678>/);
    assert.deepEqual([...contents.matchAll(/<https:\/\/chapter.example.test\/events\/(event-\d+)>/g)].map(match => match[1]), events.map(e => e.id));
});

test('skips empty claims, isolates group errors and never sends an already-consumed claim', async () => {
    const claimed = new Set();
    const sent = [];
    const finished = [];
    const reported = [];
    const worker = createDigestWorker({
        listGroups: async () => ['empty', 'A', 'B'].map(id => ({ id })),
        validateDestination: async () => {},
        claim: async ({ id: group }, kind, window) => {
            assert.equal(kind, 'weekly');
            assert.equal(window.start, '2026-11-30T05:00:00.000Z');
            if (group === 'empty' || claimed.has(group)) return null;
            claimed.add(group);
            return { ...digest, name: group };
        },
        finish: async (group) => { finished.push(group); },
        send: async (group, messages) => {
            assert.equal(messages.length, 1);
            sent.push(group.name);
            if (group.name === 'A') throw new Error('Indeterminate network result');
        },
        report: (...args) => reported.push(args),
        websiteUrl,
    });

    await worker('weekly', now);
    await worker('weekly', now);
    assert.deepEqual(sent, ['A', 'B']);
    assert.deepEqual(finished, ['B']);
    assert.equal(reported.length, 1);
});

test('checks the destination and refuses an everyone role', async () => {
    const guildId = '10000000000000003';
    const channel = {
        id: channelId, isSendable: () => true, isThread: () => false,
        permissionsFor: () => ({ has: () => true }),
        guild: { id: guildId, roles: { fetch: async id => ({ id, mentionable: true }) } },
    };
    const client = { channels: { fetch: async () => channel } };
    await validateDestination(client, digest);
    await assert.rejects(validateDestination(client, { ...digest, discord_role_id: guildId }), /specific role/);
    channel.guild.roles.fetch = async id => ({ id, mentionable: false });
    channel.permissionsFor = () => ({ has: permission => Array.isArray(permission) });
    await assert.rejects(validateDestination(client, digest), /cannot mention/);
    channel.guild = null;
    await assert.rejects(validateDestination(client, digest), /server channel/);
});

test('makes one POST attempt against a stub even if Discord rejects the request', async () => {
    const message = buildDigestMessages(digest, 'weekly', websiteUrl)[0];
    let requests = 0;
    const mockFetch = async (url, options) => {
        requests++;
        assert.equal(url, `https://discord.com/api/v10/channels/${channelId}/messages`);
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), message);
        return { ok: false, status: 503 };
    };
    await assert.rejects(sendDigestMessage(channelId, message, 'mock-token', mockFetch), /HTTP 503/);
    assert.equal(requests, 1);
});

test('a corrected destination can still claim the same window', async () => {
    let valid = false;
    let claims = 0;
    const worker = createDigestWorker({
        listGroups: async () => [{ id: 'A' }],
        validateDestination: async () => { if (!valid) throw new Error('wrong role'); },
        claim: async () => { claims++; return digest; },
        send: async () => {}, finish: async () => {}, report: () => {}, websiteUrl,
    });
    await worker('weekly', now);
    assert.equal(claims, 0);
    valid = true;
    await worker('weekly', now);
    assert.equal(claims, 1);
});

test('a rate-limited continuation retries only that message after the requested delay', async () => {
    const posts = [];
    const waits = [];
    const request = async (_url, options) => {
        posts.push(JSON.parse(options.body).content);
        if (posts.length === 2) return { status: 429, json: async () => ({ retry_after: 0.75 }) };
        return { ok: true };
    };
    for (const content of ['first', 'continued']) {
        await sendDigestMessage(channelId, { content }, 'mock', request, async ms => waits.push(ms));
    }
    assert.deepEqual(waits, [750]);
    assert.deepEqual(posts, ['first', 'continued', 'continued']);
});
