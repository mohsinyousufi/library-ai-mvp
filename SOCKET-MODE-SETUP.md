# Socket Mode Setup Guide

Your Slack bot has been successfully converted to use Socket Mode! 🎉

## What Changed

### ✅ Code Changes
- **Removed Flask dependency** - No more web server needed
- **Added Socket Mode handler** - Direct WebSocket connection to Slack
- **Simplified environment variables** - No more `SLACK_SIGNING_SECRET` needed
- **Removed port mapping** - No external network access required

### ✅ Benefits
- **No ngrok needed** - Works behind firewalls and NAT
- **No public URL required** - Slack connects directly to your bot
- **Easier development** - Instant restarts, local debugging
- **Cost-free hosting** - Runs on your local machine

## Setup Instructions

### 1. Configure Your Slack App

1. Go to [api.slack.com](https://api.slack.com/apps) and open your app
2. Navigate to **"Socket Mode"** in the sidebar
3. **Enable Socket Mode** toggle
4. Click **"Generate Token"** to create an App-Level Token
   - Token Name: `socket-mode-token` 
   - Scope: Select `connections:write`
   - Copy the token (starts with `xapp-`)

### 2. Update Slash Commands

1. Go to **"Slash Commands"** in your Slack app settings
2. **Remove the Request URL** from your existing commands:
   - `/session` command
   - `/sessions` command
3. Save the changes

### 3. Configure Environment Variables

Create a `.env` file in your project root:

```bash
# Copy from .env.example
cp .env.example .env
```

Edit `.env` with your tokens:
```bash
# Required for Socket Mode
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-level-token-here

# Session Manager URL (for internal communication)
SESSION_MANAGER_URL=http://session-manager:8080
```

### 4. Start Your Services

```bash
# Start all services
docker-compose up

# Or start just the bot for testing
docker-compose up slack-bot
```

## Verification

If setup is successful, you should see:
```
INFO:slack_bolt.App:A new session has been established
INFO:slack_bolt.App:⚡️ Bolt app is running!
INFO:slack_bolt.App:Starting to receive messages from a new connection
```

## Testing

1. Go to your Slack workspace
2. Type `/session replit` in any channel
3. The bot should respond with a session URL
4. Type `/sessions` to list active sessions

## Troubleshooting

### Bot Token Issues
```bash
# Check if bot token is valid
SLACK_BOT_TOKEN=xoxb-your-token
curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test
```

### App Token Issues
- Ensure App-Level Token has `connections:write` scope
- Token should start with `xapp-`
- Regenerate token if needed

### Connection Issues
- Check internet connectivity
- Verify tokens are correct
- Restart the bot container

## Commands Available

- `/session [service]` - Create a new session (default: replit)
  - `/session replit` - Create Replit session
  - `/session codesandbox` - Create CodeSandbox session  
  - `/session chrome` - Create basic Chrome session

- `/sessions` - List all active sessions

## Next Steps

Your bot now works without any external dependencies! You can:
- Develop locally without ngrok
- Test changes instantly
- Deploy to any server when ready
- Add more slash commands easily

The session manager and containers still work exactly the same way - only the Slack communication method has changed from webhooks to WebSocket connections.
