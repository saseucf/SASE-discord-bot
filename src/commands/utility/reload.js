import { SlashCommandBuilder } from "discord.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Reload a command.')
        .addStringOption((option) => option.setName('command').setDescription('The command to reload').setRequired(true)),
    async execute(interaction) {
        const commandName = interaction.options.getString('command', true).toLowerCase();
        const command = interaction.client.commands.get(commandName);
        if (!command) {
            return interaction.reply(`There is no command with name \`${commandName}\`!`);
        }

        const filePath = path.join(__dirname, `${command.data.name}.js`);

        try {
            const newCommandModule = await import(`${pathToFileURL(filePath).href}?update=${Date.now()}`);
            const newCommand = newCommandModule.default;
            interaction.client.commands.set(newCommand.data.name, newCommand);
            await interaction.reply(`Command \`${newCommand.data.name}\` was reloaded!`);
        } catch (error) {
            console.error(error);
            await interaction.reply(
                `There was an error while reloading a command \`${command.data.name}\`:\n\`${error.message}\``,
            );
        }
    },
};
