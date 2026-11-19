# SASE Discord Bot

A Discord bot for the SASE community. This repository contains the bot source code, configuration, and deployment setup.

## Features

- Daily event reminders at 9 a.m. America/New_York, covering that calendar day.
- Sunday roundups at 9 a.m. America/New_York, covering the upcoming Monday through Sunday.
- Empty days/weeks produce no announcement. Daily posts mention the existing reminder role; weekly posts mention everyone once.
- Events are listed chronologically. Both schedules adjust for daylight saving time and no longer use the `events.reminded` flag.
- The bot must be running at the scheduled time; missed reminders are not replayed automatically.

- Responds to Discord slash commands and events
- Keeps configuration in environment variables
- Designed for local development and hosted deployment

## Requirements

### Local reminder tests

Run `npm test` on Node.js 22.3+ (module mocks require the experimental flag included in the script). Tests use fake Supabase data and a fake Discord channel with the real reminder scheduler callbacks and embed builder. They do not log in, send Discord messages, or access the database. Coverage includes daily/weekly boundaries, daylight saving changes, event ordering, mentions, empty results, and provider failures.

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

## Hackathon reminders

Normal digests now include only published chapter events (`hackathon_id IS NULL`). Hackathon sessions use a separate worker every minute, with no startup send, and a persistent delivery ledger in the same Supabase database.

Before enabling, apply the website migration `database/changes/add-hackathon-reminders.sql`, configure each hackathon's Discord channel and role, and set these server environment variables:

- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service key, required for protected claim/completion RPCs. Never expose this to browser code.
- `HACKATHON_REMINDERS_ENABLED=true`: enable the worker only after migration and destination setup. Omitted/false keeps it disabled.
- Existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DISCORD_TOKEN`, and `CHANNEL_ID` remain in use.
- `ROLE_ID`: the chapter role mentioned by daily digests. Missing or invalid values skip the daily send with a logged error; weekly digests still mention everyone. Hackathon roles are configured separately through Manage Hackathons.
- Optional `SASE_WEBSITE_URL`: the deployed public HTTPS website origin. Once the companion website update is deployed, set this to enable linked event titles and “View event details” in hackathon reminders. Leave unset to omit links during local testing.

Hackathon reminders use a SASE blue embed with the SASE logo, event description, Date / Location and Start / End rows, and a branded footer. The message heading includes a relative countdown and mentions only the configured hackathon role. Discord dates and times render in each viewer's local timezone. Website RSVP metadata is omitted from the description, and long text is capped to fit Discord embed limits. Delivery tracking and retry behavior are unchanged.

The worker claims one published session at a time within 60 minutes of its start. Late reminders are allowed only before start time. Messages contain the actual start time and mention only the hackathon role. No default-channel fallback is used; missing configuration is logged.

A unique event/reminder identity prevents automatic resend after delivery or rescheduling. Unattempted deliveries follow edits. Definite Discord 4xx rejections retry after five minutes. Timeouts, network/5xx failures, expired 30-second claims, and uncertain completion writes become `unknown` for operator review. Edits to an attempted delivery also require review. Do not automatically reset unknown rows: Discord may have accepted the message. HTTP POSTs have a 15-second timeout and no automatic retry.

Inspect the Supabase `event_reminder_deliveries` table and bot logs for failures. The website's `docs/hackathon-reminders.md` documents migration order and manual repair. Stop the old bot before rollout; retain `events.reminded` until all deployed consumers no longer use it.

`npm test` includes isolated hackathon scheduling, role-mention, provider failure, and completion-uncertainty tests. No real Discord messages or database writes are performed by these unit tests. Database concurrency and RLS tests live with the website migration (`npm run test:reminders-db`).
