#!/usr/bin/env python3
"""
Simple test script for the Session Manager
"""

import requests
import time

def test_session_manager():
    base_url = "http://localhost:8080"
    
    print("Testing Session Manager...")
    
    # Test health check
    try:
        response = requests.get(f"{base_url}/")
        print(f"Health check: {response.json()}")
    except Exception as e:
        print(f"Health check failed: {e}")
        return
    
    # Test session creation
    try:
        response = requests.post(
            f"{base_url}/sessions",
            json={"service": "chrome", "user": "test-user"}
        )
        if response.ok:
            session = response.json()
            print(f"Created session: {session}")
            
            # Wait a moment for container to start
            time.sleep(5)
            
            # Test session listing
            response = requests.get(f"{base_url}/sessions")
            if response.ok:
                sessions = response.json()
                print(f"Active sessions: {sessions}")
            
            # Test session cleanup
            session_id = session["session_id"]
            response = requests.delete(f"{base_url}/sessions/{session_id}")
            if response.ok:
                print(f"Cleaned up session: {session_id}")
            
        else:
            print(f"Failed to create session: {response.text}")
            
    except Exception as e:
        print(f"Session test failed: {e}")

if __name__ == "__main__":
    test_session_manager()
