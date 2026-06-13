import json
import time
import logging
import requests

# Set up clean logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s'
)

CITY_SEARCH = "bangalore"
BASE_IMAGE_URL = "https://images.thehelloworld.com/"
LIST_API_URL = "https://api.thehelloworld.com/v3/property/list"
CATEGORY_API_URL = "https://api.thehelloworld.com/v2/category/list"
OUTPUT_FILE = "helloworld_detailed_data.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://thehelloworld.com/",
    "Origin": "https://thehelloworld.com",
    "Content-Type": "application/json"
}

def format_image_url(path):
    """Converts the relative image path to a full cover image URL."""
    if not path:
        return None
    # Transformation logic found in HAR: replace 'original' with 'srp/desktop'
    formatted_path = path.replace("original", "srp/desktop")
    return f"{BASE_IMAGE_URL}{formatted_path}"

def scrape_helloworld():
    logging.info(f"🚀 Starting scrape for {CITY_SEARCH}")
    
    properties = []
    page = 1
    page_size = 32
    
    # 1. Fetch the master list of properties
    while True:
        payload = {
            "city": CITY_SEARCH,
            "filter": {"gender": "", "price": {}, "amenities": [], "food": False},
            "campaign": ""
        }
        url = f"{LIST_API_URL}?page={page}&page_size={page_size}"
        
        try:
            response = requests.put(url, json=payload, headers=HEADERS, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            page_properties = data.get("data", [])
            if not page_properties:
                break
                
            properties.extend(page_properties)
            logging.info(f"✅ Page {page}: Found {len(page_properties)} properties")
            page += 1
            
            if len(page_properties) < page_size:
                break
            time.sleep(1)
        except Exception as e:
            logging.error(f"💥 Failed to fetch property list: {e}")
            break

    logging.info(f"📊 Total properties to process: {len(properties)}")
    
    all_data = []
    
    # 2. Fetch specific pricing categories for each property
    for idx, prop in enumerate(properties):
        prop_id = prop.get("id")
        prop_name = prop.get("name", "Unknown")
        raw_image = prop.get("image") # Path from list API
        
        logging.info(f"[{idx+1}/{len(properties)}] Fetching details for: {prop_name}")
        
        item = {
            "id": prop_id,
            "name": prop_name,
            "locality": prop.get("locality", ""),
            "cover_image": format_image_url(raw_image),
            "single_room_costs": [],
            "sharing_room_costs": []
        }
        
        try:
            # Pricing API
            cat_response = requests.get(
                CATEGORY_API_URL, 
                params={"property_id": prop_id}, 
                headers=HEADERS, 
                timeout=10
            )
            
            if cat_response.status_code == 200:
                cat_data = cat_response.json()
                if cat_data.get("success"):
                    categories = cat_data.get("data", [])
                    
                    for cat in categories:
                        display_name = cat.get("display_name", "Standard")
                        inv_type = cat.get("inventory_type", "")
                        
                        # Mapping rents
                        s_rent = cat.get("rent", 0)
                        p_rent = cat.get("private_rent", 0) # This is the single room cost
                        
                        if p_rent and p_rent > 0:
                            item["single_room_costs"].append({
                                "room_type": f"{display_name} ({inv_type})",
                                "cost": p_rent
                            })
                        
                        if s_rent and s_rent > 0:
                            item["sharing_room_costs"].append({
                                "room_type": f"{display_name} ({inv_type})",
                                "cost": s_rent
                            })
                else:
                    logging.warning(f"   ⚠️ API detail success=False for {prop_name}")
            else:
                logging.error(f"   ❌ Error {cat_response.status_code} for {prop_name}")
                            
        except Exception as e:
            logging.error(f"   💥 Exception fetching details for {prop_name}: {e}")
            
        all_data.append(item)
        time.sleep(0.5)

    # 3. Save the results
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, indent=4)

    logging.info(f"✨ Scrape complete. Data saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    scrape_helloworld()