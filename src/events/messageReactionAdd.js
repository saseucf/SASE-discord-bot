import { Events } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        // Ignore bot reactions
        if (user.bot) return;

        // If the reaction is on an uncached message, fetch the full data
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        // Check if this message + emoji has a reaction role in the database
        const { data } = await supabase
            .from('reaction_roles')
            .select('role_id')
            .eq('message_id', reaction.message.id)
            .eq('emoji', reaction.emoji.name)
            .single();

        if (!data) return;

        // Add the role to the user
        try {
            const member = await reaction.message.guild.members.fetch(user.id);
            await member.roles.add(data.role_id);
        } catch (error) {
            console.error(`Failed to add role: ${error.message}`);
        }
    },
};
