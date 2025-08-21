#!/usr/bin/env python3
"""
Session Manager Service
Manages containerized user sessions using Docker
"""

import os
import json
import uuid
import logging
import requests
from pathlib import Path
from typing import Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import docker
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Session Manager", version="1.0.0")

# Mount the share page
try:
    app.mount("/share", StaticFiles(directory="share-page", html=True), name="share")
    logger.info("Share page mounted successfully")
except Exception as e:
    logger.error(f"Failed to mount share page: {e}")

# Docker client
try:
    client = docker.from_env()
    logger.info("Connected to Docker daemon")
except Exception as e:
    logger.error(f"Failed to connect to Docker: {e}")
    exit(1)

# Data directory for persistent storage
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DATA_DIR.mkdir(exist_ok=True)
sessions_file = DATA_DIR / "sessions.json"

class SessionRequest(BaseModel):
    user: str
    service: str = "unified-dashboard"  # Optional, defaults to unified dashboard

class SessionResponse(BaseModel):
    session_id: str
    url: str
    port: int

class LinkShareRequest(BaseModel):
    name: str = ""
    url: str
    description: str = ""
    channel: str = "public-works"

def load_sessions() -> Dict[str, Any]:
    """Load sessions from file"""
    if sessions_file.exists():
        try:
            return json.loads(sessions_file.read_text())
        except Exception as e:
            logger.error(f"Error loading sessions: {e}")
            return {}
    return {}

def save_sessions(sessions: Dict[str, Any]) -> None:
    """Save sessions to file"""
    try:
        sessions_file.write_text(json.dumps(sessions, indent=2))
    except Exception as e:
        logger.error(f"Error saving sessions: {e}")

def cleanup_dead_containers():
    """Remove dead containers from sessions"""
    sessions = load_sessions()
    to_remove = []
    
    for session_id, session_data in sessions.items():
        try:
            container = client.containers.get(session_data["container_id"])
            if container.status != "running":
                logger.info(f"Removing dead session {session_id}")
                to_remove.append(session_id)
                try:
                    container.remove(force=True)
                except:
                    pass
        except docker.errors.NotFound:
            logger.info(f"Container for session {session_id} not found, removing")
            to_remove.append(session_id)
        except Exception as e:
            logger.error(f"Error checking container for session {session_id}: {e}")
    
    for session_id in to_remove:
        sessions.pop(session_id, None)
    
    if to_remove:
        save_sessions(sessions)

@app.get("/")
def root():
    """Health check endpoint"""
    return {"status": "ok", "service": "session-manager"}

@app.get("/dashboard")
def unified_dashboard():
    """Serve the unified dashboard landing page"""
    try:
        template_path = Path(__file__).parent / "templates" / "unified_dashboard.html"
        if template_path.exists():
            return HTMLResponse(content=template_path.read_text(), status_code=200)
        else:
            logger.error(f"Dashboard template not found: {template_path}")
            return HTMLResponse(content="<h1>Dashboard template not found</h1>", status_code=404)
    except Exception as e:
        logger.error(f"Error serving dashboard: {e}")
        return HTMLResponse(content="<h1>Error loading dashboard</h1>", status_code=500)

@app.get("/sessions")
def list_sessions():
    """List all active sessions"""
    cleanup_dead_containers()
    sessions = load_sessions()
    return sessions

@app.post("/sessions", response_model=SessionResponse)
def create_session(request: SessionRequest):
    """Create a new unified containerized session"""
    cleanup_dead_containers()
    
    session_id = f"sess-{str(uuid.uuid4())[:8]}"
    
    logger.info(f"Creating unified session {session_id} for user {request.user}")
    
    # Unified configuration - all sessions use the same dashboard
    config = {
        "image": "kasmweb/chrome:1.15.0",
        "environment": {
            "VNC_PW": "password",
            "KASM_URL": "http://session-manager:8080/dashboard",
            "VNC_RESOLUTION": "1280x720",
            "VNC_COL_DEPTH": "24",
            "VNC_DISABLE_AUTH": "1",
            "VNC_ENABLE_AUTH": "false",
            "VNCOPTIONS": "-disableBasicAuth"
        }
    }
    
    port = 6901  # KasmVNC web port
    
    try:
        # Start container
        container = client.containers.run(
            config["image"],
            ports={f"{port}/tcp": None},
            environment=config.get("environment", {}),
            detach=True,
            name=f"session-{session_id}",
            remove=False,
            shm_size="512m",  # Required for browsers
            security_opt=["seccomp=unconfined"],  # Required for Chrome in containers
            network="library-ai-mvp_app-network"  # Connect to the same network
        )
        
        # Get assigned port
        container.reload()
        port_bindings = container.ports.get(f"{port}/tcp")
        if not port_bindings:
            raise HTTPException(status_code=500, detail="Failed to get container port")
            
        host_port = port_bindings[0]["HostPort"]
        
        # Save session data
        sessions = load_sessions()
        sessions[session_id] = {
            "container_id": container.id,
            "port": int(host_port),
            "service": "unified-dashboard",  # Always unified now
            "user": request.user,
            "container_name": container.name
        }
        save_sessions(sessions)
        
        logger.info(f"Session {session_id} created successfully on port {host_port}")
        
        return SessionResponse(
            session_id=session_id,
            url=f"https://localhost:{host_port}",
            port=int(host_port)
        )
        
    except Exception as e:
        logger.error(f"Error creating session {session_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")

@app.post("/api/share-link")
def share_link_to_slack(request: LinkShareRequest):
    """Share a link to Slack channel"""
    try:
        # Get Slack bot URL from environment or use default
        slack_bot_url = os.environ.get("SLACK_BOT_URL", "http://slack-bot:3000")
        
        # Send request to Slack bot to post message
        response = requests.post(
            f"{slack_bot_url}/api/share-link",
            json={
                "name": request.name,
                "url": request.url,
                "description": request.description,
                "channel": request.channel
            },
            timeout=10
        )
        
        if response.ok:
            return {"message": "Link shared successfully"}
        else:
            logger.error(f"Failed to share link to Slack: {response.text}")
            raise HTTPException(status_code=500, detail="Failed to share link to Slack")
            
    except Exception as e:
        logger.error(f"Error sharing link: {e}")
        raise HTTPException(status_code=500, detail=f"Error sharing link: {str(e)}")

@app.delete("/sessions/{session_id}")
def cleanup_session(session_id: str):
    """Clean up a specific session"""
    sessions = load_sessions()
    
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session_data = sessions[session_id]
    
    try:
        container = client.containers.get(session_data["container_id"])
        container.remove(force=True)
        logger.info(f"Removed container for session {session_id}")
    except docker.errors.NotFound:
        logger.warning(f"Container for session {session_id} not found")
    except Exception as e:
        logger.error(f"Error removing container for session {session_id}: {e}")
    
    # Remove from sessions
    del sessions[session_id]
    save_sessions(sessions)
    
    return {"message": f"Session {session_id} cleaned up"}

@app.delete("/sessions")
def cleanup_all_sessions():
    """Clean up all sessions"""
    sessions = load_sessions()
    
    for session_id, session_data in sessions.items():
        try:
            container = client.containers.get(session_data["container_id"])
            container.remove(force=True)
            logger.info(f"Removed container for session {session_id}")
        except Exception as e:
            logger.error(f"Error removing container for session {session_id}: {e}")
    
    # Clear all sessions
    save_sessions({})
    return {"message": "All sessions cleaned up"}

if __name__ == "__main__":
    logger.info("Starting Session Manager...")
    uvicorn.run(app, host="0.0.0.0", port=8080)
