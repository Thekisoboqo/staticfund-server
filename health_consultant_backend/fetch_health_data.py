import os
import datetime
import time
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/fitness.activity.read',
    'https://www.googleapis.com/auth/fitness.heart_rate.read',
    'https://www.googleapis.com/auth/fitness.sleep.read'
]

def get_google_fit_service():
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
    return build('fitness', 'v1', credentials=creds)

def fetch_heart_rate(service):
    print("\n--- Fetching Heart Rate (Last 24 Hours) ---")
    
    # Calculate nanosecond timestamps for the last 24 hours
    now = datetime.datetime.now(datetime.timezone.utc)
    one_day_ago = now - datetime.timedelta(days=1)
    
    end_time = int(time.mktime(now.timetuple()) * 1e9)
    start_time = int(time.mktime(one_day_ago.timetuple()) * 1e9)
    
    dataset_id = f"{start_time}-{end_time}"
    
    try:
        # Use the "derived" heart rate stream which aggregates data from all devices (including Honor via Health Connect)
        data_source = "derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm"
        dataset = service.users().dataSources().datasets().get(
            userId='me',
            dataSourceId=data_source,
            datasetId=dataset_id
        ).execute()

        points = dataset.get('point', [])
        if not points:
            print("No heart rate data found for the last 24 hours.")
            return

        print(f"Found {len(points)} heart rate readings!")
        
        # Display the 5 most recent readings
        print("\nLast 5 readings:")
        for point in points[-5:]:
            val = point['value'][0].get('fpVal') or point['value'][0].get('intVal')
            start_nanos = int(point['startTimeNanos'])
            timestamp = datetime.datetime.fromtimestamp(start_nanos / 1e9).strftime('%Y-%m-%d %H:%M:%S')
            print(f"Time: {timestamp} | Heart Rate: {val} bpm")

    except Exception as e:
        print(f"Error fetching heart rate: {e}")

def fetch_steps(service):
    print("\n--- Fetching Step Count (Today) ---")
    
    now = datetime.datetime.now(datetime.timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    end_time = int(time.mktime(now.timetuple()) * 1e9)
    start_time = int(time.mktime(start_of_day.timetuple()) * 1e9)
    
    dataset_id = f"{start_time}-{end_time}"
    
    try:
        data_source = "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps"
        dataset = service.users().dataSources().datasets().get(
            userId='me',
            dataSourceId=data_source,
            datasetId=dataset_id
        ).execute()

        points = dataset.get('point', [])
        if not points:
            print("No step data found for today.")
            return

        total_steps = 0
        for point in points:
            val = point['value'][0].get('intVal', 0)
            total_steps += val

        print(f"Total Steps Today: {total_steps}")

    except Exception as e:
        print(f"Error fetching steps: {e}")

if __name__ == '__main__':
    service = get_google_fit_service()
    if service:
        fetch_heart_rate(service)
        fetch_steps(service)
