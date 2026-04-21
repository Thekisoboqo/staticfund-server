import os
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
    creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    return build('fitness', 'v1', credentials=creds)

def discover_data_sources(service):
    print("\n--- Discovering All Available Data Sources ---")
    
    try:
        data_sources = service.users().dataSources().list(userId='me').execute()
        
        sources = data_sources.get('dataSource', [])
        if not sources:
            print("No data sources found at all.")
            return

        print(f"Found {len(sources)} total data sources. Listing relevant ones:\n")
        
        for source in sources:
            stream_name = source.get('dataStreamName', '')
            data_type = source.get('dataType', {}).get('name', '')
            source_id = source.get('dataStreamId', '')
            
            # Filter to only show heart rate or step count to keep output clean
            if 'heart_rate' in data_type or 'step_count' in data_type:
                print(f"Type: {data_type}")
                print(f"Name: {stream_name}")
                print(f"ID:   {source_id}")
                print("-" * 40)

    except Exception as e:
        print(f"Error fetching data sources: {e}")

if __name__ == '__main__':
    service = get_google_fit_service()
    if service:
        discover_data_sources(service)
