import { createClient } from '@supabase/supabase-js';

export function createDigestStore(url, serviceRoleKey) {
    const supabase = createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    async function rpc(name, args) {
        const { data, error } = await supabase.rpc(name, args);
        if (error) throw error;
        return data;
    }

    return {
        listGroups: () => rpc('list_chapter_digest_groups', {}),
        claim: (group, kind, window) => rpc('claim_chapter_digest', {
            p_group_id: group.id,
            p_channel_id: group.discord_channel_id,
            p_role_id: group.discord_role_id,
            p_kind: kind,
            p_window_start: window.start,
            p_window_end: window.end,
        }),
        finish: async (groupId, kind, window) => {
            const delivered = await rpc('finish_chapter_digest', {
                p_group_id: groupId,
                p_kind: kind,
                p_window_start: window.start,
            });
            if (!delivered) throw new Error('Digest delivery acknowledgement matched no claim');
        },
    };
}
