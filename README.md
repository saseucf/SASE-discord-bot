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

The bot posts today's published chapter events at 9:00 a.m. Eastern and the
upcoming Monday through Sunday's events at 6:00 p.m. Eastern on Sundays.
Officers configure each audience's channel and role under **Discord reminder channels**.
The event's **Reminder audience** controls delivery. It defaults to the workshop
subcategory or General, and officers can change it for any event.
Empty destinations receive no message.

Apply the companion website migration before starting this bot version. Set
`SUPABASE_URL`, a server-only `SUPABASE_SERVICE_ROLE_KEY`, and
`SASE_WEBSITE_URL` (the chapter website's public HTTPS origin) in the bot
environment. Digests use the channel and role on each group. The bot needs
access to that Discord server and permission to send in that channel. The role
must be mentionable there, either through the role setting or the bot's channel
permissions.

The database records one claim per group, digest type, and date window. If a
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
