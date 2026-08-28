import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
})

export default async function remindEvent() {
    const now = new Date()
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    
    const {data} = await supabase
        .from('events')
        .select('*')
        .gte('start_time', now.toISOString())
        .lt('start_time', oneHourLater.toISOString())
        .eq('reminded', false)
    
    return data;
}

export async function getWeeklyEvents() {
    const now = new Date();
    const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data } = await supabase
        .from('events')
        .select('*')
        .gte('start_time', now.toISOString())
        .lt('start_time', oneWeekLater.toISOString());

    return data;
}

export async function markReminded(id) {
    const { data, error } = await supabase.from('events').update({reminded: true}).eq('id', id).select();
    console.log('markReminded result:', { data, error });
}