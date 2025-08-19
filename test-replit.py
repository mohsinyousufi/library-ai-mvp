#!/usr/bin/env python3
"""
Test script specifically for Replit session creation
"""

import requests
import time

def test_replit_session():
    base_url = "http://localhost:8080"
    
    print("🧪 Testing Replit Session Creation...")
    
    # Test health check
    try:
        response = requests.get(f"{base_url}/")
        print(f"✅ Health check: {response.json()}")
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return
    
    # Test Replit session creation
    try:
        print("🚀 Creating Replit session...")
        response = requests.post(
            f"{base_url}/sessions",
            json={"service": "replit", "user": "test-user"}
        )
        
        if response.ok:
            session = response.json()
            print(f"✅ Created Replit session: {session}")
            print(f"🌐 Access URL: {session['url']}")
            print(f"🔗 Direct link: http://localhost:{session['port']}")
            print(f"📝 Session ID: {session['session_id']}")
            print()
            print("🎯 Expected behavior:")
            print("  1. Open the URL in your browser")
            print("  2. KasmVNC interface should load")
            print("  3. Chrome browser should automatically navigate to https://replit.com/~")
            print("  4. You should see the Replit dashboard")
            
            # Wait a moment for container to start
            print("\n⏳ Waiting 10 seconds for container to fully start...")
            time.sleep(10)
            
            # Test session listing
            response = requests.get(f"{base_url}/sessions")
            if response.ok:
                sessions = response.json()
                print(f"📋 Active sessions: {len(sessions)} session(s)")
                for sid, data in sessions.items():
                    print(f"  - {sid}: {data['service']} on port {data['port']}")
            
            # Ask user if they want to clean up
            cleanup = input("\n🗑️  Clean up the session? (y/n): ").lower()
            if cleanup == 'y':
                session_id = session["session_id"]
                response = requests.delete(f"{base_url}/sessions/{session_id}")
                if response.ok:
                    print(f"✅ Cleaned up session: {session_id}")
                else:
                    print(f"❌ Failed to clean up session: {response.text}")
            else:
                print(f"💡 Session {session['session_id']} left running. Clean up manually later.")
            
        else:
            print(f"❌ Failed to create Replit session: {response.text}")
            
    except Exception as e:
        print(f"❌ Replit session test failed: {e}")

if __name__ == "__main__":
    test_replit_session()
