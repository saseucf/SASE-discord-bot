import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDigestMessages, createDigestWorker } from '../src/chapter-digests.js';
import { registerDigestSchedule, sendDigestMessage, sendToEventGroup } from '../src/schedule.js';

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
        listGroups: async () => ['empty', 'A', 'B'],
        claim: async (group, kind, window) => {
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
    const sent = [];
    const guildId = '10000000000000003';
    const client = { channels: { fetch: async (id) => ({
        id,
        isSendable: () => true,
        guild: { id: guildId, roles: { fetch: async (id) => ({ id, mentionable: true }) } },
    }) } };
    const messages = buildDigestMessages(digest, 'weekly', websiteUrl);
    const post = async (...args) => sent.push(args);
    await sendToEventGroup(client, digest, messages, 'mock-token', post);
    await assert.rejects(sendToEventGroup(client, { ...digest, discord_role_id: guildId }, messages, 'mock-token', post), /specific role/);
    assert.deepEqual(sent, [[channelId, messages[0], 'mock-token']]);
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
