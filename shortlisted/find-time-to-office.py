import json
import time
import os
import urllib.parse
import shutil
import sys
import select
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

# ==========================================
# CONFIGURATION
# ==========================================
DESTINATION = "Samhita Plaza, 248, 80 Feet Rd, Defence Colony, Indiranagar, Bangalore"
TRANSIT_DATA_PARAMS = "data=!4m6!4m5!2m3!6e0!7e2!8j1778590800!3e3"
DATA_JS_PATH = os.path.join(os.path.dirname(__file__), '..', 'js', 'data.js')
LIMIT = None  # Change to None to process all, or a number for testing

def clean_pg_name(name):
    """Replicates the cleanName logic from app.js"""
    return name.replace('/Paying Guest', '').replace('PG/Paying Guest', 'PG')

def clean_text(text):
    """Removes currency symbols and non-ASCII icons"""
    if not text: return text
    text = text.replace('₹', '')
    # Remove decimal points from cost/time if any
    if '.' in text and text.replace('.', '').isdigit():
        text = text.split('.')[0]
    return "".join(c for c in text if ord(c) < 128).strip()

def get_driver():
    chrome_options = Options()
    # chrome_options.add_argument("--headless") 
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=chrome_options)

def check_skip():
    """Returns True if Enter was pressed in the terminal"""
    if select.select([sys.stdin], [], [], 0)[0]:
        sys.stdin.readline()  # Clear the input buffer
        return True
    return False

def main():
    # 1. Load and parse data.js
    if not os.path.exists(DATA_JS_PATH):
        print(f"Error: Could not find {DATA_JS_PATH} at {os.path.abspath(DATA_JS_PATH)}")
        return

    try:
        with open(DATA_JS_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
            # Extract JSON array from "const ALL_PGS = [...];"
            json_str = content.replace('const ALL_PGS = ', '').strip()
            if json_str.endswith(';'):
                json_str = json_str[:-1]
            all_pgs = json.loads(json_str)
    except Exception as e:
        print(f"Error parsing data.js: {e}")
        return

    # 2. Select PGs to process
    # Skip ones that already have any commute data populated
    to_process = []
    for pg in all_pgs:
        # If commute_time is missing, null, or "N/A", we should process it
        if pg.get('commute_time') in [None, "N/A", ""]:
            to_process.append(pg)
    
    if LIMIT:
        to_process = to_process[:LIMIT]

    if not to_process:
        print("All PGs already have commute data or no PGs found.")
        return

    print(f"Starting commute check for {len(to_process)} PGs...")
    print("[TIP] Press ENTER in this terminal at any time to skip the current PG.\n")
    driver = get_driver()
    
    try:
        for pg in to_process:
            clean_name = clean_pg_name(pg['name'])
            origin = f"{clean_name}, {pg['locality']}, Bangalore"
            
            encoded_origin = urllib.parse.quote(origin)
            encoded_dest = urllib.parse.quote(DESTINATION)
            search_url = f"https://www.google.com/maps/dir/{encoded_origin}/{encoded_dest}/{TRANSIT_DATA_PARAMS}"
            
            print(f"Checking: {clean_name}...", end=" ", flush=True)
            driver.get(search_url)
            
            try:
                # Manual wait loop to allow for skipping
                start_time = time.time()
                total_time_raw = "N/A"
                user_skipped = False
                
                while time.time() - start_time < 25: # 25 second timeout
                    if check_skip():
                        user_skipped = True
                        break
                    
                    try:
                        # Try to find the commute time element
                        element = driver.find_element(By.XPATH, '//div[contains(@class, "Fk3sm")]')
                        total_time_raw = element.text
                        break
                    except:
                        time.sleep(0.5)

                if user_skipped:
                    print("Skipped by user.")
                    pg['commute_time'] = "N/A" # Mark so it's not immediately re-tried this session
                    continue

                # Extract other data
                try:
                    cost_raw = driver.find_element(By.XPATH, '//span[contains(@class, "tUEI8e") and contains(text(), "₹")]').text
                except:
                    cost_raw = "0"

                try:
                    walking_raw = driver.find_element(By.XPATH, '//span[contains(@class, "tUEI8e") and .//span[contains(@aria-label, "Walking")]]').text
                except:
                    walking_raw = "0 min"

                # Update PG object with nulls for zero/invalid values
                ctime = clean_text(total_time_raw)
                ccost = clean_text(cost_raw)
                cwalk = clean_text(walking_raw)

                pg['commute_time'] = ctime if ctime != "N/A" else None
                pg['commute_cost'] = int(ccost) if (ccost and ccost.isdigit() and ccost != "0") else None
                pg['commute_walking'] = cwalk if (cwalk and cwalk != "0 min" and cwalk != "0") else None
                
                print(f"Found: {pg['commute_time']} | ₹{pg['commute_cost']} | {pg['commute_walking']} walk")
            except Exception as e:
                pg['commute_time'] = None
                print(f"Failed: {str(e)[:30]}")
            
            time.sleep(1) 

    except KeyboardInterrupt:
        print("\n[!] Script interrupted by user. Saving progress...")
    finally:
        driver.quit()

        # 3. Save back to data.js
        print(f"\nSaving results to {DATA_JS_PATH}...")
        
        # Create backup
        if os.path.exists(DATA_JS_PATH):
            shutil.copy2(DATA_JS_PATH, DATA_JS_PATH + ".bak")
        
        try:
            with open(DATA_JS_PATH, 'w', encoding='utf-8') as f:
                f.write("const ALL_PGS = ")
                json.dump(all_pgs, f, indent=2, ensure_ascii=False)
                f.write(";")
            print("Successfully updated data.js (Backup created as data.js.bak)")
        except Exception as e:
            print(f"Error saving data.js: {e}")

if __name__ == "__main__":
    main()
