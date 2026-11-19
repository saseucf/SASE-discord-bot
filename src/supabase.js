import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getReminderWindow } from './reminder-windows.js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
export async function getReminderEvents(kind, now = new Date()) {
    const { start, end } = getReminderWindow(kind, now);
    const { data, error } = await supabase.from('events').select('*')
        .eq('status', 'published').is('hackathon_id', null)
        .gte('start_time', start).lt('start_time', end)
        .order('start_time', { ascending: true });
    if (error) throw error;
    return data ?? [];
}
