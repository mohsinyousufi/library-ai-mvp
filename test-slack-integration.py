#!/usr/bin/env python3
"""
Test script to simulate Slack command and check integration
"""

import requests
import json

def test_session_creation():
    """Test session creation via Slack bot"""
    print("Testing Slack bot integration...")
    
    # Test 1: Direct session manager
    print("\n1. Testing session manager directly...")
    response = requests.post(
        "http://localhost:8080/sessions",
        json={"service": "replit", "user": "test_user"},
        timeout=30
    )
    
    if response.ok:
        session_data = response.json()
        print(f"✅ Session created: {session_data}")
        print(f"   URL: {session_data['url']}")
        print(f"   Session ID: {session_data['session_id']}")
        return session_data
    else:
        print(f"❌ Session creation failed: {response.text}")
        return None

def test_slack_bot_health():
    """Test Slack bot health endpoint"""
    print("\n2. Testing Slack bot health...")
    
    try:
        response = requests.get("http://localhost:3001/health", timeout=5)
        if response.ok:
            print("✅ Slack bot is running")
            return True
        else:
            print(f"❌ Slack bot health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Failed to reach Slack bot: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Testing Library AI MVP Slack Integration")
    print("=" * 50)
    
    # Test Slack bot health
    slack_ok = test_slack_bot_health()
    
    # Test session creation
    session_data = test_session_creation()
    
    print("\n" + "=" * 50)
    if slack_ok and session_data:
        print("✅ Integration test PASSED")
        print(f"\n🌐 You can now access your session at: {session_data['url']}")
        print("📱 Your Slack bot should be ready to handle /session commands")
    else:
        print("❌ Integration test FAILED")
        print("   Check the logs for more details")
