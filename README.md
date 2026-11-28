# SASE Discord Bot

A Discord bot for the SASE community. This repository contains the bot source code, configuration, and deployment setup.

## Features

- Responds to Discord slash commands and events
- Keeps configuration in environment variables
- Designed for local development and hosted deployment

## Requirements

- Node.js 20 or later
- A Discord application and bot token
- The bot invited to a Discord server with the required permissions

## Setup

1. Clone the repository and enter the project directory:

   ```bash
   git clone <repository-url>
   cd SASE-discord-bot
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the project root:

   ```env
   DISCORD_TOKEN=your-discord-bot-token
   CLIENT_ID=your-discord-application-id
   GUILD_ID=your-development-server-id
   ```

   Keep the token private and do not commit the `.env` file.

4. Start the bot in development mode:

   ```bash
   npm run dev
   ```

## Available Scripts

Update this table when the project scripts are added or changed.

| Command | Description |
| --- | --- |
| `npm run dev` | Start the bot locally with development settings |
| `npm start` | Start the bot in production |
| `npm test` | Run the test suite |
| `npm run lint` | Check code style and lint rules |

## Discord Configuration

Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), add a bot user, and copy its token into `.env`.

When generating an invite URL, select:

- **Scopes:** `bot`, `applications.commands`
- **Permissions:** only the permissions required by the bot's commands

For development, register commands against a test server using `GUILD_ID`. Global commands can take longer to appear.

## Chapter event digests

The bot sends one roundup of published chapter events at 9 a.m. Eastern each
day. On Sundays at 6 p.m. Eastern it sends the upcoming Monday through Sunday
schedule. Both go to the same announcement channel. Only the first message in
each roundup mentions the opt-in role. Empty roundups are skipped.

Apply the companion website migration. Set `SUPABASE_URL`, the server-only
`SUPABASE_SERVICE_ROLE_KEY`, `SASE_WEBSITE_URL` (for event links), and these
Discord IDs on the bot host:

| Variable | Purpose |
| --- | --- |
| `DISCORD_REMINDERS_CHANNEL_ID` | Announcement channel for all event reminders |
| `DISCORD_REMINDERS_ROLE_ID` | Dedicated opt-in role shared by daily and weekly reminders |
| `DISCORD_BOT_SETTINGS_CHANNEL_ID` | Channel where members turn reminder pings on or off |

Give members view access to the announcement channel. Disable posting and
thread creation/replies for ordinary members there, and allow posting for the
bot and admins. Review any existing channel overrides that allow posting.
The bot needs permission to send and mention the reminder role there.

Create a reminder role with no server permissions or privileged channel
overrides. Put it below the bot's role and grant the bot Manage Roles.
Restart the bot after setting the IDs. Register the slash commands using
`node src/deploy-commands.js` with the target guild configured. An admin runs
`/reminder-settings` in the bot settings channel to publish the buttons.
Members click Enable reminders or Disable reminders to update their own role.

The database records one claim per digest type and date window. If a
send or its acknowledgement fails, check Discord before posting a replacement
manually. A claim without a delivery timestamp can mean nothing was sent, some
messages in a long digest went through, or Discord accepted the whole digest.
The scheduled jobs don't replay earlier time slots on startup.

`npm test` uses mock destinations and covers scheduling, formatting, mentions,
and send failures.

## Project Structure

The structure may grow as features are added:

```text
SASE-discord-bot/
├── src/              # Bot source code
├── .env.example      # Environment variable template
├── package.json      # Dependencies and scripts
└── README.md         # Project documentation
```

## Deployment

Set the required environment variables in the hosting platform, install production dependencies, and run:

```bash
npm start
```

The bot process must stay running and have network access to Discord's gateway.

## Contributing

1. Create a feature branch.
2. Make focused changes.
3. Run the available tests and checks.
4. Open a pull request with a short description of the change.

## License

Add the project's license here when one is selected.
