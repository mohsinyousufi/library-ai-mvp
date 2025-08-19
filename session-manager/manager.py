#!/usr/bin/env python3
"""
Session Manager Service
Manages containerized user sessions using Docker
"""

import os
import json
import uuid
import logging
from pathlib import Path
from typing import Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import docker
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Session Manager", version="1.0.0")

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
    service: str
    user: str

class SessionResponse(BaseModel):
    session_id: str
    url: str
    port: int

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

@app.get("/sessions")
def list_sessions():
    """List all active sessions"""
    cleanup_dead_containers()
    sessions = load_sessions()
    return sessions

@app.post("/sessions", response_model=SessionResponse)
def create_session(request: SessionRequest):
    """Create a new containerized session"""
    cleanup_dead_containers()
    
    session_id = f"sess-{str(uuid.uuid4())[:8]}"
    
    logger.info(f"Creating session {session_id} for service {request.service} and user {request.user}")
    
    # Service-specific container configurations
    service_configs = {
        "replit": {
            "image": "kasmweb/chrome:1.15.0",
            "environment": {
                "VNC_PW": "password",
                "KASM_URL": "https://replit.com/~"
            }
        },
        "codesandbox": {
            "image": "kasmweb/chrome:1.15.0", 
            "environment": {
                "VNC_PW": "password",
                "KASM_URL": "https://codesandbox.io"
            }
        },
        "chrome": {
            "image": "kasmweb/chrome:1.15.0",
            "environment": {
                "VNC_PW": "password"
            }
        }
    }
    
    config = service_configs.get(request.service, service_configs["chrome"])
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
            shm_size="512m"  # Required for browsers
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
            "service": request.service,
            "user": request.user,
            "container_name": container.name
        }
        save_sessions(sessions)
        
        logger.info(f"Session {session_id} created successfully on port {host_port}")
        
        return SessionResponse(
            session_id=session_id,
            url=f"http://localhost:{host_port}",
            port=int(host_port)
        )
        
    except Exception as e:
        logger.error(f"Error creating session {session_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")

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
