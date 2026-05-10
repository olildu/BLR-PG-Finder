import json
import time
import os
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

import urllib.parse

# ==========================================
# CONFIGURATION
# ==========================================
DESTINATION = "Samhita Plaza, 248, 80 Feet Rd, Defence Colony, Indiranagar, Bangalore"
# The exact transit data parameter string from app.js (Transit mode + fixed timestamp)
TRANSIT_DATA_PARAMS = "data=!4m6!4m5!2m3!6e0!7e2!8j1778590800!3e3"

def clean_pg_name(name):
    """Replicates the cleanName logic from app.js"""
    return name.replace('/Paying Guest', '').replace('PG/Paying Guest', 'PG')

def get_driver():
    chrome_options = Options()
    # chrome_options.add_argument("--headless") # Recommended: run without a visible window
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=chrome_options)

def main():
    # Define paths relative to this script's location (the 'shortlisted' folder)
    # shortlisted.json is in the same folder as this script
    shortlisted_path = 'shortlisted.json'
    # data.js is up one level in the 'js' folder
    data_js_path = os.path.join('..', 'js', 'data.js')

    # 1. Load shortlisted.json
    try:
        with open(shortlisted_path, 'r') as f:
            shortlisted = json.load(f)
        favorites = set(shortlisted.get('favorites', []))
    except FileNotFoundError:
        print(f"Error: Could not find {shortlisted_path}")
        return

    # 2. Load and parse data.js
    try:
        with open(data_js_path, 'r') as f:
            content = f.read()
            # Extract JSON array from "const ALL_PGS = [...];"
            json_str = content.replace('const ALL_PGS = ', '').strip()
            if json_str.endswith(';'):
                json_str = json_str[:-1]
            all_pgs = json.loads(json_str)
    except FileNotFoundError:
        print(f"Error: Could not find {data_js_path}. Check your folder structure.")
        return
    except Exception as e:
        print(f"Error parsing data.js: {e}")
        return

    favorite_pgs = [pg for pg in all_pgs if pg.get('url') in favorites][:3] # Limited to 3 for dev
    results = {}
    
    if not favorite_pgs:
        print("No favorite PGs found to check.")
        return

    driver = get_driver()
    try:
        for pg in favorite_pgs:
            clean_name = clean_pg_name(pg['name'])
            origin = f"{clean_name}, {pg['locality']}, Bangalore"
            
            # Replicate the URL encoding from app.js
            encoded_origin = urllib.parse.quote(origin)
            encoded_dest = urllib.parse.quote(DESTINATION)
            
            # Construct Directions URL (Transit mode with fixed timestamp)
            # Replicates: ${dirBaseUrl}/${origin}/${officeDest}/${transitDataParams}
            search_url = f"https://www.google.com/maps/dir/{encoded_origin}/{encoded_dest}/{TRANSIT_DATA_PARAMS}"
            
            print(f"Checking: {clean_name}...")
            driver.get(search_url)
            
            try:
                # 1. Wait for the trip list to load
                wait = WebDriverWait(driver, 20)

                # 2. Extract Data
                try:
                    total_time = wait.until(EC.presence_of_element_located((By.XPATH, '//div[contains(@class, "Fk3sm")]'))).text
                except:
                    total_time = "N/A"

                try:
                    cost = driver.find_element(By.XPATH, '//span[contains(@class, "tUEI8e") and contains(text(), "₹")]').text
                except:
                    cost = "0"

                try:
                    walking_time = driver.find_element(By.XPATH, '//span[contains(@class, "tUEI8e") and .//span[contains(@aria-label, "Walking")]]').text
                except:
                    walking_time = "0 min"

                # 3. Clean the data: Remove INR symbol and non-ASCII characters (like icons)
                def clean_text(text):
                    if not text: return text
                    text = text.replace('₹', '')
                    return "".join(c for c in text if ord(c) < 128).strip()

                total_time = clean_text(total_time)
                cost = clean_text(cost)
                # Remove decimal points from cost (e.g., 60.00 -> 60)
                if '.' in cost:
                    cost = cost.split('.')[0]
                walking_time = clean_text(walking_time)

                results[clean_name] = {
                    "origin": origin,
                    "total_time": total_time,
                    "cost": cost,
                    "walking_time": walking_time,
                    "status": "Success"
                }
                print(f" Found: {total_time} | {cost} | {walking_time} walking")
            except Exception as e:
                results[clean_name] = {
                    "origin": origin, 
                    "total_time": "N/A", 
                    "cost": "N/A", 
                    "walking_time": "N/A", 
                    "status": f"Error: {str(e)[:50]}"
                }
                print(f" [!] Failed: {str(e)[:50]}")
            
            time.sleep(2) # Be gentle with Google Maps

    finally:
        driver.quit()

    # 3. Save the results in the current 'shortlisted' folder
    output_path = 'travel_times_scraped.json'
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=4)
    
    print(f"\nScraping complete. Results saved to: {os.path.abspath(output_path)}")

if __name__ == "__main__":
    main()