#!/usr/bin/env python3
"""
Simple Slack Bot for Session Management
Handles /session commands to create containerized user sessions
"""

import os
import requests
import logging
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from flask import Flask, request, jsonify

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Slack app for Socket Mode
app = App(token=os.environ.get("SLACK_BOT_TOKEN"))

# Initialize Flask app for API endpoints
flask_app = Flask(__name__)

@flask_app.route("/api/share-link", methods=["POST"])
def share_link_endpoint():
    """API endpoint to share links to Slack"""
    try:
        data = request.get_json()
        name = data.get("name", "")
        url = data.get("url")
        description = data.get("description", "")
        channel = data.get("channel", "public-works")
        
        if not url:
            return jsonify({"error": "URL is required"}), 400
        if not name:
            return jsonify({"error": "Name is required"}), 400
        
        # Format message with name
        if name and description:
            message = f"🔗 *Shared by {name}*\n{description}\n{url}"
        else:
            message = f"🔗 *Shared by {name}*\n{url}"

        
        # Post to Slack channel
        client = app.client
        response = client.chat_postMessage(
            channel=f"#{channel}",
            text=message,
            unfurl_links=True,
            unfurl_media=True
        )
        
        if response["ok"]:
            logger.info(f"Link shared successfully to #{channel}: {url}")
            return jsonify({"message": "Link shared successfully"})
        else:
            logger.error(f"Failed to share link: {response.get('error')}")
            return jsonify({"error": "Failed to share link"}), 500
            
    except Exception as e:
        logger.error(f"Error in share_link_endpoint: {e}")
        return jsonify({"error": str(e)}), 500

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
            session_id = session_data['session_id']
            
            # Create message with interactive button
            if service == "replit":
                message_text = f"🚀 Your Replit session is ready!\n" \
                              f"Access your Replit dashboard here: {session_data['url']}\n" \
                              f"Session ID: `{session_id}`\n" \
                              f"💡 The browser will automatically load Replit for you!\n" \
                              f"📤 Share links to #public-works: http://session-manager:8080/share/"

            elif service == "suno":
                message_text = f"🚀 Your Suno session is ready!\n" \
                              f"Access your Suno dashboard here: {session_data['url']}\n" \
                              f"Session ID: `{session_id}`\n" \
                              f"💡 The browser will automatically load Suno for you!\n" \
                              f"📤 Share links to #public-works: http://session-manager:8080/share/"

            elif service == "chatbot":
                message_text = f"🚀 Your Chatbot session is ready!\n" \
                              f"Access your Chatbot dashboard here: {session_data['url']}\n" \
                              f"Session ID: `{session_id}`\n" \
                              f"💡 The browser will automatically load Chatbot for you!\n" \
                              f"📤 Share links to #public-works: http://session-manager:8080/share/"

            else:
                message_text = f"🚀 Your {service} session is ready!\n" \
                              f"Access it here: {session_data['url']}\n" \
                              f"Session ID: `{session_id}`\n" \
                              f"📤 Share links to #public-works: http://session-manager:8080/share/"
            
            # Create interactive message with End Session button
            blocks = [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": message_text
                    }
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "🛑 End Session"
                            },
                            "style": "danger",
                            "action_id": "end_session",
                            "value": session_id
                        }
                    ]
                }
            ]
            
            respond(text=message_text, blocks=blocks)
        else:
            error_msg = f"Failed to create session: {response.text}"
            logger.error(error_msg)
            respond(f"❌ Error creating session: {error_msg}")
            
    except Exception as e:
        error_msg = f"Exception creating session: {str(e)}"
        logger.error(error_msg)
        respond(f"❌ Error creating session: {error_msg}")

@app.action("end_session")
def handle_end_session(ack, body, respond):
    """Handle End Session button click"""
    ack()
    
    session_id = body["actions"][0]["value"]
    user_id = body["user"]["id"]
    
    logger.info(f"User {user_id} requesting to end session {session_id}")
    
    try:
        # Request session cleanup from manager
        session_manager_url = os.environ.get("SESSION_MANAGER_URL", "http://session-manager:8080")
        response = requests.delete(f"{session_manager_url}/sessions/{session_id}", timeout=10)
        
        if response.ok:
            # Update the original message to show session ended
            updated_text = f"✅ Session `{session_id}` has been terminated successfully."
            updated_blocks = [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": updated_text
                    }
                }
            ]
            
            respond(text=updated_text, blocks=updated_blocks, replace_original=True)
            logger.info(f"Session {session_id} ended successfully")
        else:
            error_msg = f"Failed to end session: {response.text}"
            logger.error(error_msg)
            respond(f"❌ Error ending session: {error_msg}")
            
    except Exception as e:
        error_msg = f"Exception ending session: {str(e)}"
        logger.error(error_msg)
        respond(f"❌ Error ending session: {error_msg}")

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
    
    if not os.environ.get("SLACK_APP_TOKEN"):
        logger.error("SLACK_APP_TOKEN not set")
        exit(1)
        
    try:
        import threading
        
        # Start Socket Mode handler in a separate thread
        def start_socket_mode():
            handler = SocketModeHandler(app, os.environ.get("SLACK_APP_TOKEN"))
            logger.info("Slack bot starting in Socket Mode...")
            handler.start()
        
        socket_thread = threading.Thread(target=start_socket_mode, daemon=True)
        socket_thread.start()
        
        # Start Flask app for API endpoints
        logger.info("Starting Flask API server on port 3000...")
        flask_app.run(host="0.0.0.0", port=3000, debug=False)
        
    except Exception as e:
        logger.error(f"Failed to start Slack bot: {e}")
        exit(1)
