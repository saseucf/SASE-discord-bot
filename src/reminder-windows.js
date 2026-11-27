export const TIME_ZONE = 'America/New_York';
const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function parts(date) {
    return Object.fromEntries(formatter.formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]));
}
// Convert Eastern calendar midnight to UTC, including daylight saving changes.
function midnight(date) {
    const target = date.getTime();
    let instant = target;
    for (let i = 0; i < 3; i++) {
        const p = parts(new Date(instant));
        instant += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    }
    return new Date(instant).toISOString();
}
export function getReminderWindow(kind, now = new Date()) {
    if (!['daily', 'weekly'].includes(kind)) throw new Error('Unknown reminder kind');
    const p = parts(now);
    const start = new Date(Date.UTC(p.year, p.month - 1, p.day));
    if (kind === 'weekly') {
        const daysUntilMonday = (8 - start.getUTCDay()) % 7 || 7;
        start.setUTCDate(start.getUTCDate() + daysUntilMonday);
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + (kind === 'weekly' ? 7 : 1));
    return { start: midnight(start), end: midnight(end) };
}
