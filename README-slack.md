# Slack-Driven Session Orchestration

A simple system that allows Slack users to create containerized browser sessions through slash commands.

## Features

- `/session [service]` - Create a new browser session (defaults to replit)
- `/sessions` - List all active sessions
- Automatic cleanup of dead containers
- Support for multiple services (replit, codesandbox, chrome)

## Setup

### 1. Slack App Configuration

1. Go to https://api.slack.com/apps and create a new app
2. Enable the following features:
   - **Slash Commands**: Add `/session` and `/sessions` commands
   - **Bot Token Scopes**: Add `chat:write` and `commands`
3. Install the app to your workspace
4. Copy the Bot User OAuth Token and Signing Secret

### 2. Environment Configuration

Update the `.env` file with your Slack credentials:

```bash
SLACK_BOT_TOKEN="xoxb-your-bot-token-here"
SLACK_SIGNING_SECRET="your-signing-secret-here"
```

### 3. Start the Services

```bash
docker-compose up -d
```

This will start:
- **LiteLLM Proxy** (port 4000)
- **OpenWebUI** (port 3000) 
- **Slack Bot** (port 3001)
- **Session Manager** (port 8080)

### 4. Configure Slack Commands

In your Slack app settings, set the request URLs for your slash commands:

- `/session` command URL: `http://your-domain:3001/slack/events`
- `/sessions` command URL: `http://your-domain:3001/slack/events`

## Usage

### Creating Sessions

In Slack, use the `/session` command:

```
/session replit        # Creates a Replit session
/session codesandbox   # Creates a CodeSandbox session  
/session chrome        # Creates a basic Chrome session
/session               # Defaults to replit
```

The bot will respond with a URL to access your containerized browser session.

### Listing Sessions

Use `/sessions` to see all active sessions:

```
/sessions
```

### Session Management

Sessions are automatically cleaned up when containers stop. You can also manually manage them via the Session Manager API:

- `GET http://localhost:8080/sessions` - List sessions
- `DELETE http://localhost:8080/sessions/{session_id}` - Remove specific session
- `DELETE http://localhost:8080/sessions` - Remove all sessions

## Architecture

```
Slack → Slack Bot → Session Manager → Docker → KasmVNC Containers
                         ↓
                   File-based Storage
```

## Services

### Slack Bot (`slack-bot/bot.py`)
- Handles Slack slash commands
- Communicates with Session Manager
- Provides user feedback

### Session Manager (`session-manager/manager.py`)
- FastAPI service for managing Docker containers
- Creates KasmVNC-based browser sessions
- Stores session state in JSON files

### Supported Services

- **replit**: Opens https://replit.com in the browser
- **codesandbox**: Opens https://codesandbox.io in the browser  
- **chrome**: Basic Chrome browser session

## Technical Details

- **Base Images**: Uses `kasmweb/chrome:1.15.0` for browser sessions
- **VNC Access**: Sessions are accessible via web browser (no VNC client needed)
- **Default Password**: `password` (can be customized)
- **Session Storage**: JSON files in `/data` volume
- **Container Networking**: All services communicate via Docker internal network

## Troubleshooting

### Check Service Status
```bash
docker-compose ps
```

### View Logs
```bash
docker-compose logs slack-bot
docker-compose logs session-manager
```

### Test Session Manager Directly
```bash
curl -X POST http://localhost:8080/sessions \
  -H "Content-Type: application/json" \
  -d '{"service": "chrome", "user": "test"}'
```

### Common Issues

1. **Slack commands not working**: Check that request URLs are correctly configured
2. **Sessions not starting**: Ensure Docker daemon is running and accessible
3. **Port conflicts**: Check that ports 3001 and 8080 are available

## Security Notes

- Sessions are accessible without authentication (suitable for internal use)
- All containers run with default Docker security settings
- Slack bot token should be kept secure
- Consider using HTTPS and proper authentication for production use
