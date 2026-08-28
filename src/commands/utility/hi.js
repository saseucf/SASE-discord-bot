import { SlashCommandBuilder } from "discord.js";

export default {
    cooldown: 5,
    data : new SlashCommandBuilder().setName('hi').setDescription('Replies with Pong!'), 
    async execute(interaction) {
        await interaction.reply(`Yo whats up ${interaction.user.username}`)
    },
}