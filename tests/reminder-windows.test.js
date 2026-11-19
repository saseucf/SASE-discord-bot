import test from 'node:test';
import assert from 'node:assert/strict';
import { getReminderWindow } from '../src/reminder-windows.js';

const cases = [
    ['daily winter', 'daily', '2026-11-18T14:00:00Z', '2026-11-18T05:00:00.000Z', '2026-11-19T05:00:00.000Z'],
    ['Eastern date before UTC midnight rolls over', 'daily', '2026-11-19T02:00:00Z', '2026-11-18T05:00:00.000Z', '2026-11-19T05:00:00.000Z'],
    ['spring forward day', 'daily', '2027-03-14T13:00:00Z', '2027-03-14T05:00:00.000Z', '2027-03-15T04:00:00.000Z'],
    ['fall back day', 'daily', '2026-11-01T14:00:00Z', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['Sunday upcoming week', 'weekly', '2026-11-22T14:00:00Z', '2026-11-23T05:00:00.000Z', '2026-11-30T05:00:00.000Z'],
    ['week spanning spring forward', 'weekly', '2027-03-07T14:00:00Z', '2027-03-08T05:00:00.000Z', '2027-03-15T04:00:00.000Z'],
    ['week spanning fall back', 'weekly', '2026-10-25T13:00:00Z', '2026-10-26T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['week spanning year boundary', 'weekly', '2026-12-27T14:00:00Z', '2026-12-28T05:00:00.000Z', '2027-01-04T05:00:00.000Z'],
];
for (const [name, kind, now, start, end] of cases) {
    test(name, () => assert.deepEqual(getReminderWindow(kind, new Date(now)), { start, end }));
}
