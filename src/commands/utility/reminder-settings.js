import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('reminder-settings')
        .setDescription('Post the event reminder opt-in buttons in the bot settings channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
            || interaction.channelId !== process.env.DISCORD_BOT_SETTINGS_CHANNEL_ID) {
            await interaction.reply({ content: 'An admin can post this panel in the bot settings channel.', flags: MessageFlags.Ephemeral });
            return;
        }
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('reminder:enable').setLabel('Enable reminders').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('reminder:disable').setLabel('Disable reminders').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ content: 'Choose whether you get pinged for SASE event reminders.', components: [row] });
    },
};
