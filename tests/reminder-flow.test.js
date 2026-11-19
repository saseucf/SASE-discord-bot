import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// No credentials, database connection, timers, or Discord connection in this suite.
mock.module('dotenv/config', { namedExports: {} });
process.env.HACKATHON_REMINDERS_ENABLED = 'false';
const jobs = [];
let rows = [];
let queryError = null;
let queries = [];
mock.module('node-cron', { defaultExport: {
    schedule(expression, callback, options) { jobs.push({ expression, callback, options }); },
} });
mock.module('@supabase/supabase-js', { namedExports: {
    createClient() {
        return { from(table) {
            const query = { table };
            queries.push(query);
            return {
                select(columns) { query.columns = columns; return this; },
                eq(field, value) { query[field] = value; return this; },
                is(field, value) { query[field] = value; return this; },
                gte(field, value) { query.start = value; return this; },
                lt(field, value) { query.end = value; return this; },
                async order(field, options) {
                    query.order = { field, ...options };
                    return { error: queryError, data: rows
                        .filter(row => row.start_time >= query.start && row.start_time < query.end && row.status === query.status && row.hackathon_id === query.hackathon_id)
                        .sort((a, b) => a.start_time.localeCompare(b.start_time)) };
                },
            };
        } };
    },
} });
const { default: startSchedule } = await import('../src/schedule.js');
const messages = [];
let fetchCount = 0;
let sendError = false;
const client = { channels: { async fetch() {
    fetchCount++;
    return { async send(payload) {
        if (sendError) throw new Error('Discord unavailable');
        messages.push({ ...payload, embeds: payload.embeds.map(embed => embed.toJSON()) });
    } };
} } };
function event(title, start_time) {
    return { title, start_time, end_time: new Date(Date.parse(start_time) + 3600000).toISOString(),
        status: 'published', hackathon_id: null, event_type: 'Workshop', description: 'Local test event', location: 'UCF', reminded: true };
}
startSchedule(client);

test('local reminder flow with fake database and Discord', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-22T14:00:00Z') });
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const reset = () => {
        process.env.ROLE_ID = '123456789012345678';
        messages.length = 0; queries = []; rows = []; queryError = null;
        fetchCount = 0; sendError = false; errors.length = 0;
    };
    await t.test('registers only daily and Sunday 9am Eastern jobs', () => {
        assert.deepEqual(jobs.map(({ expression, options }) => ({ expression, options })), [
            { expression: '0 9 * * *', options: { timezone: 'America/New_York', noOverlap: true } },
            { expression: '0 9 * * 0', options: { timezone: 'America/New_York', noOverlap: true } },
        ]);
    });
    await t.test('daily selects the whole Eastern day, orders events and mentions role once', async () => {
        reset();
        rows = [event('Evening', '2026-11-23T04:59:59.000Z'), event('Tomorrow', '2026-11-23T05:00:00.000Z'),
            event('Midnight', '2026-11-22T05:00:00.000Z'), event('Yesterday', '2026-11-22T04:59:59.000Z'),
            {...event('Hackathon', '2026-11-22T18:00:00.000Z'), hackathon_id: 'hack'},
            {...event('Draft', '2026-11-22T18:00:00.000Z'), status: 'draft'},
            {...event('Cancelled', '2026-11-22T18:00:00.000Z'), status: 'cancelled'}];
        await jobs[0].callback();
        assert.deepEqual(messages.map(m => m.embeds[0].title), ['Midnight', 'Evening']);
        assert.match(messages[0].content, /<@&123456789012345678>/);
        assert.equal(messages[1].content, undefined);
        assert.match(messages[1].embeds[0].fields[0].value, /Sunday, November 22, 2026/);
        assert.equal(queries[0].table, 'events');
        assert.deepEqual(queries[0].order, { field: 'start_time', ascending: true });
    });
    await t.test('daily skips sending when its role configuration is missing or invalid', async () => {
        for (const role of ['', 'invalid']) {
            reset(); process.env.ROLE_ID = role;
            rows = [event('Workshop', '2026-11-22T18:00:00.000Z')];
            await jobs[0].callback();
            assert.equal(fetchCount, 0); assert.equal(messages.length, 0);
            assert.equal(errors.length, 1);
        }
    });
    await t.test('Sunday roundup includes Monday through Sunday and pings everyone once', async () => {
        reset();
        rows = [event('Next Sunday', '2026-11-30T04:59:59.000Z'), event('This Sunday', '2026-11-23T04:59:59.000Z'),
            event('Monday', '2026-11-23T05:00:00.000Z'), event('Following Monday', '2026-11-30T05:00:00.000Z')];
        await jobs[1].callback();
        assert.deepEqual(messages.map(m => m.embeds[0].title), ['Monday', 'Next Sunday']);
        assert.match(messages[0].content, /@everyone.*next week/);
        assert.equal(messages[1].content, undefined);
    });
    await t.test('empty day and week do not fetch a channel or send messages', async () => {
        reset();
        await jobs[0].callback(); await jobs[1].callback();
        assert.equal(fetchCount, 0); assert.equal(messages.length, 0);
    });
    await t.test('database failure is logged without sending announcements', async () => {
        reset(); queryError = new Error('Database unavailable');
        await jobs[0].callback();
        assert.equal(fetchCount, 0); assert.equal(errors.length, 1);
    });
    await t.test('Discord failure is caught and logged', async () => {
        reset(); rows = [event('Workshop', '2026-11-22T18:00:00.000Z')]; sendError = true;
        await jobs[0].callback();
        assert.equal(messages.length, 0); assert.equal(errors.length, 1);
    });
});
