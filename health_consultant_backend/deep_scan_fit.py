"""
Deep scan of Google Fit - tries every possible method to find real watch data.
"""
import os
import datetime
import time
import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/fitness.activity.read',
    'https://www.googleapis.com/auth/fitness.heart_rate.read',
    'https://www.googleapis.com/auth/fitness.sleep.read'
]

def get_service():
    creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds.valid:
        creds.refresh(Request())
        with open('token.json', 'w') as f:
            f.write(creds.to_json())
    return build('fitness', 'v1', credentials=creds)

def ms_to_ns(ms):
    return ms * 1000000

def try_aggregate(service):
    """Try the Aggregate endpoint - this works differently from datasets."""
    print("\n========== METHOD 1: Aggregate API (Last 7 Days) ==========")
    
    now = datetime.datetime.now(datetime.timezone.utc)
    seven_days_ago = now - datetime.timedelta(days=7)
    
    # Time in milliseconds
    start_ms = int(seven_days_ago.timestamp() * 1000)
    end_ms = int(now.timestamp() * 1000)
    
    body = {
        "aggregateBy": [
            {"dataTypeName": "com.google.step_count.delta"},
            {"dataTypeName": "com.google.heart_rate.bpm"},
            {"dataTypeName": "com.google.calories.expended"},
            {"dataTypeName": "com.google.distance.delta"},
        ],
        "bucketByTime": {"durationMillis": 86400000},  # 1 day buckets
        "startTimeMillis": start_ms,
        "endTimeMillis": end_ms,
    }
    
    try:
        result = service.users().dataset().aggregate(userId='me', body=body).execute()
        buckets = result.get('bucket', [])
        
        found_data = False
        for bucket in buckets:
            start = datetime.datetime.fromtimestamp(int(bucket['startTimeMillis']) / 1000)
            for ds in bucket.get('dataset', []):
                for point in ds.get('point', []):
                    found_data = True
                    data_type = point.get('dataTypeName', 'unknown')
                    vals = point.get('value', [])
                    val_str = ", ".join([str(v.get('intVal', v.get('fpVal', '?'))) for v in vals])
                    print(f"  {start.strftime('%Y-%m-%d')} | {data_type}: {val_str}")
        
        if not found_data:
            print("  No aggregated data found for the last 7 days.")
    except Exception as e:
        print(f"  Error: {e}")

def try_sessions(service):
    """Try the Sessions endpoint - might find sleep or workout sessions."""
    print("\n========== METHOD 2: Sessions API (Last 30 Days) ==========")
    
    now = datetime.datetime.now(datetime.timezone.utc)
    thirty_days_ago = now - datetime.timedelta(days=30)
    
    start_time = thirty_days_ago.isoformat()
    end_time = now.isoformat()
    
    try:
        result = service.users().sessions().list(
            userId='me',
            startTime=start_time,
            endTime=end_time
        ).execute()
        
        sessions = result.get('session', [])
        if not sessions:
            print("  No sessions (sleep, workouts, etc.) found.")
            return
        
        print(f"  Found {len(sessions)} sessions!")
        for s in sessions:
            name = s.get('name', 'Unnamed')
            activity_type = s.get('activityType', '?')
            app = s.get('application', {}).get('packageName', 'Unknown')
            start_ms = int(s.get('startTimeMillis', 0))
            start_dt = datetime.datetime.fromtimestamp(start_ms / 1000).strftime('%Y-%m-%d %H:%M')
            print(f"  {start_dt} | {name} (Type: {activity_type}) from {app}")
    except Exception as e:
        print(f"  Error: {e}")

def try_all_data_sources(service):
    """List ALL data sources, not just heart rate and steps."""
    print("\n========== METHOD 3: ALL Data Sources (Unfiltered) ==========")
    
    try:
        result = service.users().dataSources().list(userId='me').execute()
        sources = result.get('dataSource', [])
        
        if not sources:
            print("  Absolutely no data sources registered in Google Fit.")
            return
        
        print(f"  Found {len(sources)} data sources:")
        for s in sources:
            print(f"  - Type: {s.get('dataType', {}).get('name', '?')}")
            print(f"    Stream: {s.get('dataStreamId', '?')}")
            print(f"    Device: {s.get('device', {}).get('manufacturer', 'Unknown')} {s.get('device', {}).get('model', '')}")
            print()
    except Exception as e:
        print(f"  Error: {e}")

if __name__ == '__main__':
    service = get_service()
    try_all_data_sources(service)
    try_aggregate(service)
    try_sessions(service)
    print("\n========== SCAN COMPLETE ==========")
