import { Events } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) {
        if (user.bot) return;

        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        const { data } = await supabase
            .from('reaction_roles')
            .select('role_id')
            .eq('message_id', reaction.message.id)
            .eq('emoji', reaction.emoji.name)
            .single();

        if (!data) return;

        try {
            const member = await reaction.message.guild.members.fetch(user.id);
            await member.roles.remove(data.role_id);
        } catch (error) {
            console.error(`Failed to remove role: ${error.message}`);
        }
    },
};
