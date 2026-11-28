import { MessageFlags } from 'discord.js';

export async function handleReminderButton(interaction, env = process.env) {
    const enable = interaction.customId === 'reminder:enable';
    if (!enable && interaction.customId !== 'reminder:disable') return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild() || interaction.channelId !== env.DISCORD_BOT_SETTINGS_CHANNEL_ID) {
        await interaction.editReply('Use the reminder buttons in the bot settings channel.');
        return;
    }

    try {
        const roleId = env.DISCORD_REMINDERS_ROLE_ID?.trim();
        const role = roleId && await interaction.guild.roles.fetch(roleId);
        if (!role || role.id === interaction.guild.id || role.managed || !role.editable || role.permissions.bitfield !== 0n) {
            await interaction.editReply('Ask an admin to configure a reminder role with no server permissions below the bot role.');
            return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (enable) await member.roles.add(role.id);
        else await member.roles.remove(role.id);
        await interaction.editReply(enable ? 'Event reminder pings enabled.' : 'Event reminder pings disabled.');
    } catch (error) {
        console.error('Could not update reminder membership', error);
        await interaction.editReply('Could not update your reminder role. Please try again or ask an admin.');
    }
}
