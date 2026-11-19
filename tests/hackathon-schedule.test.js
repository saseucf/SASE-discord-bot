import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
const jobs = [];
const calls = [];
mock.module('node-cron', { defaultExport: { schedule: (...args) => jobs.push(args) } });
mock.module('@supabase/supabase-js', { namedExports: { createClient: (...args) => {
    calls.push(args);
    return { rpc: async () => ({ data: null, error: null }) };
} } });
const { startHackathonSchedule } = await import('../src/hackathon-reminders.js');
test('hackathon job is opt-in, requires server key, and never sends on startup', () => {
    process.env.HACKATHON_REMINDERS_ENABLED = 'false';
    startHackathonSchedule(); assert.equal(jobs.length, 0);
    process.env.HACKATHON_REMINDERS_ENABLED = 'true';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(startHackathonSchedule, /server-only/);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-test-key';
    process.env.SUPABASE_URL = 'http://localhost';
    startHackathonSchedule();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0][0], '* * * * *');
    assert.deepEqual(jobs[0][2], { noOverlap: true, timezone: 'America/New_York' });
    assert.equal(calls[0][1], 'fake-test-key');
});
