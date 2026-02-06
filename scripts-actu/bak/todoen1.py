import os
import json
import urllib.request
import re
import sys

IMAGE_DIR = "./img"
OUTPUT_SUBDIR = "processed"
DB_FILE = "database_reliquias11.json"
DRY_RUN = False

CONVERT_TO_WEBP = True
WEBP_QUALITY = 80
RESIZE = True
MAX_PIXELS = 256

URL_RELICS = "https://cdn.jsdelivr.net/gh/WFCD/warframe-drop-data@gh-pages/data/relics.json"
URL_ITEMS_ALL = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/All.json"

try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False

def clean_filename(text):
    if not text: return ""
    t = text.lower()
    t = re.sub(r'[\s_\.]+', '-', t)
    t = re.sub(r'[^a-z0-9\-]', '', t)
    return t.strip('-')

def fetch_data():
    try:
        req = urllib.request.Request(URL_ITEMS_ALL, headers={'User-Agent': 'Python-Script'})
        with urllib.request.urlopen(req) as url:
            all_items = json.loads(url.read().decode())
    except Exception as e:
        print(f"Error fetching items: {e}")
        return None

    price_map = {}
    for item in all_items:
        parent_name = item.get('name', '')
        if item.get('ducats'):
            price_map[parent_name] = item.get('ducats')

        for comp in item.get('components', []):
            if comp.get('ducats'):
                comp_name = comp.get('name', '')
                if "Prime" not in comp_name and "Prime" in parent_name:
                     full_name = f"{parent_name} {comp_name}"
                     price_map[full_name] = comp.get('ducats')
                else:
                    price_map[comp_name] = comp.get('ducats')

    try:
        req = urllib.request.Request(URL_RELICS, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as url:
            relics_data = json.loads(url.read().decode())
    except Exception as e:
        print(f"Error fetching relics: {e}")
        return None

    db = {}
    for relic in relics_data.get('relics', []):
        if relic.get('state') != 'Intact': continue

        relic_name = f"{relic.get('tier')} {relic.get('relicName')}"

        for reward in relic.get('rewards', []):
            item_name = reward.get('itemName', '')
            if not item_name or "Kuva" in item_name or "Endo" in item_name: continue

            key = clean_filename(item_name)

            if key not in db:
                ducats = price_map.get(item_name, 0)
                if ducats == 0:
                    ducats = price_map.get(item_name.replace(" Blueprint", ""), 0)

                db[key] = {
                    "name": item_name,
                    "ducats": ducats,
                    "slug": key,
                    "relics": set()
                }

            db[key]["relics"].add(relic_name)

    for k, v in db.items():
        v["relics"] = sorted(list(v["relics"]))

    with open(DB_FILE, "w", encoding='utf-8') as f:
        json.dump(db, f, indent=2)

    return db

def find_match(filename, db):
    clean_name = clean_filename(os.path.splitext(filename)[0])
    sorted_keys = sorted(db.keys(), key=len, reverse=True)

    for key in sorted_keys:
        if key in clean_name:
            return True, key
    return False, None

def process_images(db):
    if not os.path.exists(IMAGE_DIR):
        print(f"Directory {IMAGE_DIR} not found.")
        return

    output_path = os.path.join(IMAGE_DIR, OUTPUT_SUBDIR)
    if not os.path.exists(output_path) and not DRY_RUN:
        os.makedirs(output_path)

    files = sorted(os.listdir(IMAGE_DIR))
    count = 0

    for filename in files:
        src_file = os.path.join(IMAGE_DIR, filename)

        if os.path.isdir(src_file): continue
        _, ext = os.path.splitext(filename)
        if ext.lower() not in ['.png', '.jpg', '.jpeg', '.webp']: continue

        found, key = find_match(filename, db)

        if not found:
            continue

        item_data = db[key]
        ducats = item_data['ducats']
        slug = item_data['slug']

        new_base = f"{ducats}_{slug}"
        new_ext = ".webp" if CONVERT_TO_WEBP else ext.lower()

        dest_file = os.path.join(output_path, f"{new_base}{new_ext}")

        c = 1
        while os.path.exists(dest_file):
            dest_file = os.path.join(output_path, f"{new_base}_{c}{new_ext}")
            c += 1

        final_name = os.path.basename(dest_file)

        if DRY_RUN:
            print(f"[MOVE/RENAME] {filename} -> {OUTPUT_SUBDIR}/{final_name}")
            print(f"   L Locations: {item_data['relics']}")
        else:
            try:
                processed = False
                if PILLOW_AVAILABLE:
                    with Image.open(src_file) as img:
                        if RESIZE and (img.width > MAX_PIXELS or img.height > MAX_PIXELS):
                            img.thumbnail((MAX_PIXELS, MAX_PIXELS))

                        if CONVERT_TO_WEBP:
                            img.save(dest_file, "WEBP", quality=WEBP_QUALITY, optimize=True)
                            processed = True
                        else:
                            img.save(dest_file, optimize=True)
                            processed = True

                if processed:
                    os.remove(src_file)
                else:
                    os.rename(src_file, dest_file)

                count += 1
            except Exception as e:
                print(f"Error processing {filename}: {e}")

    print(f"Processed {count} images.")
    if DRY_RUN: print("DRY RUN COMPLETE")

if __name__ == "__main__":
    db = fetch_data()
    if db:
        process_images(db)
