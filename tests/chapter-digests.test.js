import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDigestMessages, createDigestWorker } from '../src/chapter-digests.js';
import { readDestination, registerDigestSchedule, sendDigestMessage, validateDestination } from '../src/schedule.js';
import { createDigestStore } from '../src/supabase.js';

const websiteUrl = 'https://chapter.example.test';
const role = '10000000000000001';
const channelId = '10000000000000002';
const destination = { discord_channel_id: channelId, discord_role_id: role };
const event = { id: 'event-id', title: 'Study Night', location: 'Library', start_time: '2026-11-30T23:00:00Z' };
const digest = { ...destination, events: [event] };
const sunday = new Date('2026-11-29T23:00:00Z');
const weeklyWindow = { start: '2026-11-30T05:00:00.000Z', end: '2026-12-07T05:00:00.000Z' };
const legacyAudiences = ['General', 'Pro-Dev', 'Tech', 'Pre-Health', 'Service', 'Socials', 'Fundraisers'];

// Events of every type, as the database returns them (already sorted).
const combined = [
    { id: 'a', title: 'Tech Workshop', location: 'HEC', start_time: '2026-11-30T15:00:00Z' },
    { id: 'b', title: 'Service Day', location: null, start_time: '2026-12-01T15:00:00Z' },
    { id: 'c', title: 'Social Night', location: 'Union', start_time: '2026-12-02T23:00:00Z' },
    { id: 'd', title: 'General Body Meeting', location: 'CB1', start_time: '2026-12-03T23:00:00Z' },
];

function harness({ claimResult = combined, validate, sendError, finishError } = {}) {
    const calls = [];
    let claimed = false;
    const worker = createDigestWorker({
        destination,
        websiteUrl,
        validateDestination: async (...args) => {
            calls.push(['validate', ...args]);
            if (validate) await validate();
        },
        claim: async (...args) => {
            calls.push(['claim', ...args]);
            if (claimed) return null; // The database hands out each window once.
            claimed = true;
            return claimResult;
        },
        send: async (...args) => {
            calls.push(['send', ...args]);
            if (sendError) throw sendError;
        },
        finish: async (...args) => {
            calls.push(['finish', ...args]);
            if (finishError) throw finishError;
        },
    });
    return { worker, calls, names: () => calls.map(([name]) => name) };
}

test('registers the Eastern daily and Sunday jobs using their scheduled instant', async () => {
    const jobs = [];
    const calls = [];
    registerDigestSchedule((...args) => calls.push(args), (...args) => jobs.push(args));
    assert.deepEqual(jobs.map(([expression,, options]) => [expression, options]), [
        ['0 9 * * *', { timezone: 'America/New_York', noOverlap: true }],
        ['0 18 * * 0', { timezone: 'America/New_York', noOverlap: true }],
    ]);
    assert.deepEqual(calls, []);
    for (const [, run] of jobs) await run({ date: sunday });
    assert.deepEqual(calls, [['daily', sunday], ['weekly', sunday]]);
});

test('the scheduler reports a failed digest instead of crashing', async () => {
    const jobs = [];
    const reported = [];
    const failure = new Error('boom');
    registerDigestSchedule(async () => { throw failure; }, (...args) => jobs.push(args), (...args) => reported.push(args));
    await jobs[0][1]({ date: sunday });
    assert.equal(reported.length, 1);
    assert.match(reported[0][0], /daily/);
    assert.equal(reported[0][1], failure);
});

test('posts one combined digest for all event types in the order the database returns', async () => {
    const { worker, calls, names } = harness();
    await worker('weekly', sunday);
    assert.deepEqual(names(), ['validate', 'claim', 'send', 'finish']);

    const sends = calls.filter(([name]) => name === 'send');
    assert.equal(sends.length, 1);
    const messages = sends[0].find(Array.isArray);
    const text = messages.map(message => message.content).join('\n');
    const titles = [...text.matchAll(/\*\*([^*\n]+)\*\*\n<t:/g)].map(match => match[1]);
    assert.deepEqual(titles, combined.map(e => e.title));
    const links = [...text.matchAll(/<https:\/\/chapter\.example\.test\/events\/([^>]+)>/g)].map(match => match[1]);
    assert.deepEqual(links, combined.map(e => e.id));
    assert.match(messages[0].content, /^<@&10000000000000001> \*\*Next week's events\*\*/);
    for (const audience of legacyAudiences) assert.doesNotMatch(text, new RegExp(`· ${audience}`));
});

test('claims and finishes by kind and window only, never by audience', async () => {
    const { worker, calls } = harness();
    await worker('weekly', sunday);
    const claim = calls.find(([name]) => name === 'claim');
    const finish = calls.find(([name]) => name === 'finish');
    assert.deepEqual(claim.slice(1), ['weekly', weeklyWindow]);
    assert.deepEqual(finish.slice(1), ['weekly', weeklyWindow]);
    assert.deepEqual(calls.find(([name]) => name === 'validate').slice(1), [destination]);
});

test('daily runs claim the Eastern calendar day', async () => {
    const { worker, calls } = harness();
    await worker('daily', new Date('2026-11-30T14:00:00Z'));
    assert.deepEqual(calls.find(([name]) => name === 'claim').slice(1),
        ['daily', { start: '2026-11-30T05:00:00.000Z', end: '2026-12-01T05:00:00.000Z' }]);
});

test('an invalid destination fails before claiming so the window stays available', async () => {
    let valid = false;
    const { worker, names } = harness({ validate: () => { if (!valid) throw new Error('wrong role'); } });
    await assert.rejects(worker('weekly', sunday), /wrong role/);
    assert.deepEqual(names(), ['validate']);
    valid = true;
    await worker('weekly', sunday);
    assert.deepEqual(names(), ['validate', 'validate', 'claim', 'send', 'finish']);
});

test('an empty or already-claimed window sends nothing', async () => {
    for (const claimResult of [null, []]) {
        const { worker, names } = harness({ claimResult });
        await worker('daily', sunday);
        assert.deepEqual(names(), ['validate', 'claim']);
    }
});

test('a failed send bubbles up, is not acknowledged, and is never resent', async () => {
    const { worker, names } = harness({ sendError: new Error('Indeterminate network result') });
    await assert.rejects(worker('weekly', sunday), /Indeterminate/);
    assert.deepEqual(names(), ['validate', 'claim', 'send']);
    await worker('weekly', sunday);
    assert.deepEqual(names().filter(name => name === 'send'), ['send']);
});

test('a failed acknowledgement bubbles up to the scheduler', async () => {
    const { worker } = harness({ finishError: new Error('ack matched no claim') });
    await assert.rejects(worker('weekly', sunday), /ack matched no claim/);
});

test('renders titles, times, locations and public event links', () => {
    const [message] = buildDigestMessages({ ...digest, events: [event, { ...event, id: 'second', title: 'Career Night', location: null }] }, 'weekly', websiteUrl);
    assert.match(message.content, /^<@&10000000000000001> \*\*Next week's events\*\*/);
    assert.match(message.content, /Study Night\*\*\n<t:\d+:f> .* Library .* <https:\/\/chapter.example.test\/events\/event-id>/);
    assert.match(message.content, /Study Night[\s\S]+Career Night[\s\S]+Location TBD/);
    assert.deepEqual(message.allowed_mentions, { parse: [], roles: [role], users: [], replied_user: false });
});

test('a long digest split across messages pings the role exactly once', async () => {
    const events = Array.from({ length: 40 }, (_, index) => ({
        ...event, id: `event-${index}`, title: '**@everyone** '.repeat(12),
        location: `<@&${role}> <@123456789012345678> @here ` + 'x'.repeat(150),
    }));
    const { worker, calls } = harness({ claimResult: events });
    await worker('daily', sunday);
    const messages = calls.find(([name]) => name === 'send').find(Array.isArray);
    assert.ok(messages.length > 2);
    assert.ok(messages.every(message => message.content.length <= 2000));
    assert.ok(messages.every(message => message.flags === 4));
    assert.deepEqual(messages.flatMap(message => message.allowed_mentions.roles), [role]);
    assert.ok(messages.every(message => message.allowed_mentions.parse.length === 0));
    const contents = messages.map(message => message.content).join('\n');
    assert.equal(contents.split(`<@&${role}>`).length - 1, 1);
    assert.ok(messages[0].content.startsWith(`<@&${role}>`));
    assert.doesNotMatch(contents, /@everyone|@here|<@123456789012345678>/);
    assert.deepEqual([...contents.matchAll(/<https:\/\/chapter.example.test\/events\/(event-\d+)>/g)].map(match => match[1]), events.map(e => e.id));
});

test('reads one reminder channel and role from the environment', () => {
    const env = { DISCORD_REMINDERS_CHANNEL_ID: ` ${channelId}\n`, DISCORD_REMINDERS_ROLE_ID: role };
    assert.deepEqual(readDestination(env, () => assert.fail('no error expected')), destination);
});

test('refuses missing or malformed reminder settings', () => {
    for (const env of [
        {},
        { DISCORD_REMINDERS_CHANNEL_ID: channelId },
        { DISCORD_REMINDERS_ROLE_ID: role },
        { DISCORD_REMINDERS_CHANNEL_ID: 'general', DISCORD_REMINDERS_ROLE_ID: role },
        { DISCORD_REMINDERS_CHANNEL_ID: channelId, DISCORD_REMINDERS_ROLE_ID: '01000000000000001' },
    ]) {
        const errors = [];
        assert.equal(readDestination(env, error => errors.push(error)), null);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /DISCORD_REMINDERS_CHANNEL_ID|DISCORD_REMINDERS_ROLE_ID/);
    }
});

test('ignores the legacy per-group channel settings', () => {
    const legacy = {};
    for (const id of legacyAudiences) {
        const prefix = 'DISCORD_' + id.toUpperCase().replaceAll('-', '_');
        legacy[prefix + '_CHANNEL_ID'] = '10000000000000009';
        legacy[prefix + '_ROLE_ID'] = '10000000000000008';
    }
    assert.equal(readDestination(legacy, () => {}), null);
    assert.equal(readDestination({ ...legacy, DISCORD_REMINDERS_ROLE_ID: role }, () => {}), null);
    assert.deepEqual(readDestination({ ...legacy, DISCORD_REMINDERS_CHANNEL_ID: channelId, DISCORD_REMINDERS_ROLE_ID: role }, () => {}), destination);
});

test('checks the destination and refuses an everyone role', async () => {
    const guildId = '10000000000000003';
    const channel = {
        id: channelId, isSendable: () => true, isThread: () => false,
        permissionsFor: () => ({ has: () => true }),
        guild: { id: guildId, roles: { fetch: async id => ({ id, mentionable: true }) } },
    };
    const client = { channels: { fetch: async () => channel } };
    await validateDestination(client, destination);
    await assert.rejects(validateDestination(client, { ...destination, discord_role_id: guildId }), /specific role/);
    channel.guild.roles.fetch = async id => ({ id, mentionable: false });
    channel.permissionsFor = () => ({ has: permission => Array.isArray(permission) });
    await assert.rejects(validateDestination(client, destination), /cannot mention/);
    channel.guild = null;
    await assert.rejects(validateDestination(client, destination), /server channel/);
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

test('the Supabase store calls the kind/window RPCs without an audience', async (t) => {
    const requests = [];
    const replies = [[combined], [true], [false]];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ path: new URL(String(url)).pathname, body: JSON.parse(options.body) });
        return new Response(JSON.stringify(replies.shift()[0]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const store = createDigestStore('https://stub.supabase.test', 'stub-service-key');
    assert.deepEqual(await store.claim('weekly', weeklyWindow), combined);
    await store.finish('weekly', weeklyWindow);
    await assert.rejects(store.finish('weekly', weeklyWindow), /no claim/);
    assert.deepEqual(requests.slice(0, 2), [
        { path: '/rest/v1/rpc/claim_chapter_digest', body: { p_kind: 'weekly', p_window_start: weeklyWindow.start, p_window_end: weeklyWindow.end } },
        { path: '/rest/v1/rpc/finish_chapter_digest', body: { p_kind: 'weekly', p_window_start: weeklyWindow.start } },
    ]);
});
