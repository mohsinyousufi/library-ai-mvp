#!/usr/bin/env python3
"""
Test script to verify Slack webhook endpoint
"""

import requests
import json
import hashlib
import hmac
import time

def test_slack_webhook():
    """Test the Slack webhook endpoint with a mock command"""
    print("Testing Slack webhook endpoint...")
    
    # Mock Slack command payload
    payload = {
        "token": "mock_token",
        "team_id": "T123456",
        "team_domain": "test",
        "channel_id": "C123456",
        "channel_name": "general",
        "user_id": "U123456",
        "user_name": "testuser",
        "command": "/session",
        "text": "replit",
        "response_url": "https://hooks.slack.com/commands/123/456/789",
        "trigger_id": "123.456.789"
    }
    
    # Convert to form data (how Slack sends it)
    form_data = "&".join([f"{k}={v}" for k, v in payload.items()])
    
    try:
        # Test the endpoint
        response = requests.post(
            "http://localhost:3001/slack/events",
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=5
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        
        if response.status_code == 200:
            print("✅ Webhook endpoint responding correctly")
            return True
        else:
            print(f"❌ Webhook returned status {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Error testing webhook: {e}")
        return False

if __name__ == "__main__":
    test_slack_webhook()
