#!/usr/bin/env python3
"""
Simple Slack Bot for Session Management
Handles /session commands to create containerized user sessions
"""

import os
import requests
import logging
from slack_bolt import App

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Slack app with signing secret for webhook mode
app = App(
    token=os.environ.get("SLACK_BOT_TOKEN"),
    signing_secret=os.environ.get("SLACK_SIGNING_SECRET")
)

@app.command("/session")
def handle_session_command(ack, respond, command):
    """Handle /session slash command"""
    ack()
    
    service = command.get("text", "").strip()
    if not service:
        service = "replit"  # default service
    
    user_id = command["user_id"]
    
    logger.info(f"Creating {service} session for user {user_id}")
    
    try:
        # Request new session from manager
        session_manager_url = os.environ.get("SESSION_MANAGER_URL", "http://session-manager:8080")
        response = requests.post(
            f"{session_manager_url}/sessions",
            json={"service": service, "user": user_id},
            timeout=30
        )
        
        if response.ok:
            session_data = response.json()
            if service == "replit":
                message = f"🚀 Your Replit session is ready!\n" \
                         f"Access your Replit dashboard here: {session_data['url']}\n" \
                         f"Session ID: `{session_data['session_id']}`\n" \
                         f"💡 The browser will automatically load https://replit.com/~ for you!"
            else:
                message = f"🚀 Your {service} session is ready!\n" \
                         f"Access it here: {session_data['url']}\n" \
                         f"Session ID: `{session_data['session_id']}`"
            
            respond(message)
        else:
            error_msg = f"Failed to create session: {response.text}"
            logger.error(error_msg)
            respond(f"❌ Error creating session: {error_msg}")
            
    except Exception as e:
        error_msg = f"Exception creating session: {str(e)}"
        logger.error(error_msg)
        respond(f"❌ Error creating session: {error_msg}")

@app.command("/sessions")
def handle_sessions_list(ack, respond, command):
    """Handle /sessions command to list active sessions"""
    ack()
    
    try:
        session_manager_url = os.environ.get("SESSION_MANAGER_URL", "http://session-manager:8080")
        response = requests.get(f"{session_manager_url}/sessions", timeout=10)
        
        if response.ok:
            sessions = response.json()
            if sessions:
                message = "📋 Active Sessions:\n" + "\n".join([
                    f"• {sid}: {data['service']} (Port: {data['port']})" 
                    for sid, data in sessions.items()
                ])
            else:
                message = "No active sessions"
                
            respond(message)
        else:
            respond("❌ Error fetching sessions")
            
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        respond(f"❌ Error listing sessions: {str(e)}")

if __name__ == "__main__":
    logger.info("Starting Slack bot...")
    
    # Check required environment variables
    if not os.environ.get("SLACK_BOT_TOKEN"):
        logger.error("SLACK_BOT_TOKEN not set")
        exit(1)
    
    if not os.environ.get("SLACK_SIGNING_SECRET"):
        logger.error("SLACK_SIGNING_SECRET not set")
        exit(1)
        
    try:
        # Use Flask adapter for webhook events
        from flask import Flask, request
        from slack_bolt.adapter.flask import SlackRequestHandler
        
        flask_app = Flask(__name__)
        handler = SlackRequestHandler(app)
        
        @flask_app.route("/slack/events", methods=["POST"])
        def slack_events():
            return handler.handle(request)
        
        @flask_app.route("/health", methods=["GET"])
        def health():
            return "OK"
        
        logger.info("Slack bot Flask server starting on port 3000...")
        flask_app.run(host="0.0.0.0", port=3000, debug=False)
    except Exception as e:
        logger.error(f"Failed to start Slack bot: {e}")
        exit(1)
