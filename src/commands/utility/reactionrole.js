import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Set up a reaction role message')
        .addStringOption(option =>
            option.setName('emoji').setDescription('The emoji to react with').setRequired(true))
        .addRoleOption(option =>
            option.setName('role').setDescription('The role to assign').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction) {
        const emoji = interaction.options.getString('emoji');
        const role = interaction.options.getRole('role');

        const message = await interaction.channel.send(
            `@everyone React ${emoji} to get the **${role.name}** role!`
        );

        await message.react(emoji);

        await supabase.from('reaction_roles').insert({
            message_id: message.id,
            emoji: emoji,
            role_id: role.id,
        });

        await interaction.reply({ content: 'Reaction role set up!', ephemeral: true });
    },
};
