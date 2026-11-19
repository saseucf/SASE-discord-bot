import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHackathonMessage, classifyFailure, createHackathonWorker, sendHackathonMessage } from '../src/hackathon-reminders.js';

const delivery = { id: 'delivery-1', event_id: '3f92cbba-83a2-402f-99e8-390e829afadd', channel_id_snapshot: '12345678901234567', role_id_snapshot: '12345678901234568',
    content_snapshot: { title: 'Workshop', description: 'Build together', start_time: '2027-03-06T18:00:00Z', end_time: '2027-03-06T19:00:00Z', location: 'UCF' } };
function setup(overrides = {}) {
    const calls = []; let claimed = false;
    const run = createHackathonWorker({
        claim: async () => { if (claimed) return null; claimed = true; return delivery; },
        finish: async (...args) => calls.push(args), send: async () => ({ id: 'message-1' }),
        report: () => {}, ...overrides,
    });
    return { run, calls };
}
test('message uses actual start time and only the configured role', () => {
    const body = buildHackathonMessage(delivery);
    assert.deepEqual(body.allowed_mentions, { parse: [], roles: [delivery.role_id_snapshot] });
    assert.match(body.content, /starts <t:\d+:R>/);
    assert.doesNotMatch(body.content, /in one hour|@everyone/);
    assert.equal(body.embeds[0].title, 'Workshop');
});
test('reminder shows branded date/location and start/end rows with viewer-local timestamps', () => {
    const body = buildHackathonMessage(delivery);
    assert.match(body.content, /^# Hackathon Reminder\n/);
    const embed = body.embeds[0];
    assert.equal(embed.color, 0x89ABE3);
    assert.deepEqual(embed.fields.slice(0, 6).map(f => f.name), ['Date', 'Location', '\u200b', 'Start', 'End', '\u200b']);
    assert.equal(embed.fields[3].value, `<t:${Date.parse(delivery.content_snapshot.start_time) / 1000}:t>`);
    assert.equal(embed.fields[4].value, `<t:${Date.parse(delivery.content_snapshot.end_time) / 1000}:t>`);
    assert.ok(embed.fields.slice(0, 6).every(f => f.inline));
});
test('description strips RSVP metadata and keeps long embeds within Discord limits', () => {
    const event = { ...delivery.content_snapshot, description: 'Visible\n\n===EXTERNAL_URL===https://example.com', end_time: null };
    const embed = buildHackathonMessage({ ...delivery, content_snapshot: event }).embeds[0];
    assert.equal(embed.description, 'Visible');
    assert.equal(embed.fields[4].value, 'TBD');
    const long = buildHackathonMessage({ ...delivery, content_snapshot: { ...event, title: 'T'.repeat(1000), description: 'D'.repeat(8000), location: 'L'.repeat(2000) } }).embeds[0];
    const size = long.title.length + long.description.length + long.footer.text.length + long.fields.reduce((n,f)=>n+f.name.length+f.value.length,0);
    assert.ok(size < 6000);
});
test('event links use the configured website and event identity', () => {
    const previous = process.env.SASE_WEBSITE_URL;
    try {
        process.env.SASE_WEBSITE_URL = 'https://sase.example';
        const embed = buildHackathonMessage(delivery).embeds[0];
        assert.equal(embed.url, `https://sase.example/events/${delivery.event_id}`);
        assert.match(embed.fields.at(-1).value, /View event details/);
        delete process.env.SASE_WEBSITE_URL;
        assert.equal(buildHackathonMessage(delivery).embeds[0].url, undefined);
    } finally { if(previous === undefined) delete process.env.SASE_WEBSITE_URL; else process.env.SASE_WEBSITE_URL = previous; }
});
test('successful send records delivered and message ID', async () => {
    const { run, calls } = setup(); await run();
    assert.deepEqual(calls, [['delivery-1', 'delivered', null, 'message-1']]);
});
for (const status of [400, 403, 404, 429]) test(`definite ${status} rejection is retryable`, async () => {
    const { run, calls } = setup({ send: async () => { throw { status }; } }); await run();
    assert.deepEqual(calls, [['delivery-1', 'failed', `discord_${status}`]]);
});
for (const status of [undefined, 500, 502]) test(`ambiguous ${status ?? 'transport'} failure is unknown`, async () => {
    assert.equal(classifyFailure({ status }).state, 'unknown');
    const { run, calls } = setup({ send: async () => { throw { status }; } }); await run();
    assert.deepEqual(calls, [['delivery-1', 'unknown', 'discord_delivery_ambiguous']]);
});
test('completion write failure is unknown even if database error contains a 4xx status', async () => {
    const calls = [];
    const { run } = setup({ finish: async (...args) => {
        calls.push(args); if (args[1] === 'delivered') throw { status: 400 };
    } });
    await run(); assert.equal(calls[1][1], 'unknown');
});
test('failure to record unknown stops worker without sending again', async () => {
    let sends = 0; const reports = [];
    const { run } = setup({ send: async () => { sends++; return { id: 'sent' }; },
        finish: async () => { throw new Error('Database unavailable'); }, report: (...args) => reports.push(args) });
    await run(); assert.equal(sends, 1); assert.ok(reports.length >= 1);
});
test('missing configuration is reported without a fallback destination', async () => {
    const reports = [];
    const { run } = setup({ claim: async () => null, missingConfiguration: async () => ['event-1'],
        report: (...args) => reports.push(args), send: async () => assert.fail('No fallback send') });
    await run(); assert.equal(reports[0][1][0], 'event-1');
});
test('HTTP transport makes exactly one attempt on an ambiguous response', async t => {
    let count = 0;
    t.mock.method(globalThis, 'fetch', async () => { count++; return { ok: false, status: 503 }; });
    await assert.rejects(sendHackathonMessage(delivery.channel_id_snapshot, buildHackathonMessage(delivery)));
    assert.equal(count, 1);
});
