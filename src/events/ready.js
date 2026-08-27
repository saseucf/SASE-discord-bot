import { Events } from "discord.js";
import startSchedule from '../schedule.js';

export default {
    name: Events.ClientReady, 
    once: true, 
    execute(Client) {
        console.log(`Ready, logged in as ${Client.user.tag}`);
        startSchedule(Client);
    },
};