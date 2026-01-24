import os
import json
import urllib.request
import re

try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False
    print("Error: Instala Pillow (pip install Pillow)")

IMG_DIR = "./img"
WEAPONS_SUBDIR = "weapons"
OUTPUT_FILE = "cleaned_weapons.json"

MAX_SIZE = (256, 256)
WEBP_QUALITY = 50

URLS = [
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Arch-Gun.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Melee.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Primary.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Secondary.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/SentinelWeapons.json"
]

def clean_slug(text):
    if not text: return ""
    t = text.lower()
    # Reemplaza espacios, puntos Y GUIONES por barra baja
    t = re.sub(r'[\s\-\.]+', '_', t)
    # Elimina cualquier caracter que no sea letra, número o barra baja
    t = re.sub(r'[^a-z0-9_]', '', t)
    return t.strip('_')

def clean_json_image_name(filename):
    if not filename: return None
    # Elimina el hash (ej: -17e29a3c73) manteniendo la extensión
    return re.sub(r'-[a-f0-9]+(\.[a-z]+)$', r'\1', filename)

def process_image(item_name, original_image_name_json):
    if not PILLOW_AVAILABLE: return None

    slug = clean_slug(item_name)
    if not slug: return None

    dest_dir = os.path.join(IMG_DIR, WEAPONS_SUBDIR)
    if not os.path.exists(dest_dir):
        os.makedirs(dest_dir)

    extensions = [".png", ".webp", ".jpg", ".jpeg"]
    found_src = None

    candidates = []
    if original_image_name_json:
        candidates.append(original_image_name_json)

    # 1. Busca con el slug nuevo (barra baja)
    for ext in extensions:
        candidates.append(f"{slug}{ext}")

    # 2. Busca con el slug antiguo (guion) por seguridad
    slug_hyphen = slug.replace('_', '-')
    for ext in extensions:
        candidates.append(f"{slug_hyphen}{ext}")

    for cand in candidates:
        path = os.path.join(IMG_DIR, cand)
        if os.path.exists(path):
            found_src = path
            break

    if not found_src:
        files = os.listdir(IMG_DIR)
        for f in files:
            # Busca coincidencia con barra baja O con guion
            if (f.startswith(slug) or f.startswith(slug_hyphen)) and any(f.endswith(ext) for ext in extensions):
                found_src = os.path.join(IMG_DIR, f)
                break

    if not found_src:
        return None

    try:
        dest_filename = f"{slug}.webp"
        dest_path = os.path.join(dest_dir, dest_filename)

        if os.path.exists(dest_path):
            return f"{WEAPONS_SUBDIR}/{dest_filename}"

        with Image.open(found_src) as img:
            img.thumbnail(MAX_SIZE)
            img.save(dest_path, "WEBP", quality=WEBP_QUALITY, optimize=True)
            print(f"[OPTIMIZADO] {os.path.basename(found_src)} -> {WEAPONS_SUBDIR}/{dest_filename}")
            return f"{WEAPONS_SUBDIR}/{dest_filename}"

    except Exception as e:
        print(f"Error procesando imagen {slug}: {e}")
        return None

def fetch_and_process():
    all_weapons = []

    for url in URLS:
        try:
            print(f"Descargando: {url.split('/')[-1]}...")
            req = urllib.request.Request(url, headers={'User-Agent': 'Python-Script'})
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())

                for item in data:
                    if item.get("productCategory") == "SpaceSuits": continue

                    local_path = process_image(item.get("name"), item.get("imageName"))
                    cleaned_image_name = clean_json_image_name(item.get("imageName"))

                    clean_components = []
                    if item.get("components"):
                        for comp in item.get("components"):
                            comp_local = process_image(comp.get("name"), comp.get("imageName"))
                            comp_clean_name = clean_json_image_name(comp.get("imageName"))

                            clean_components.append({
                                "name": comp.get("name"),
                                "itemCount": comp.get("itemCount"),
                                "imageName": comp_clean_name,
                                "drops": comp.get("drops", []),
                                "ducats": comp.get("ducats", 0),
                                "localImage": comp_local
                            })

                    cleaned_item = {
                        "name": item.get("name"),
                        "type": item.get("type"),
                        "category": item.get("category"),
                        # AQUÍ ESTÁ EL CAMBIO: REDONDEO A 2 DECIMALES
                        "omegaAttenuation": round(item.get("omegaAttenuation", 1.0), 2),
                        "isPrime": item.get("isPrime", False),
                        "vaulted": item.get("vaulted"),
                        "masteryReq": item.get("masteryReq", 0),
                        "components": clean_components,
                        "imageName": cleaned_image_name,
                        "localImage": local_path
                    }

                    all_weapons.append(cleaned_item)

        except Exception as e:
            print(f"Error procesando {url}: {e}")

    with open(OUTPUT_FILE, "w", encoding='utf-8') as f:
        json.dump(all_weapons, f, indent=2)

    print(f"\nProceso terminado. Datos guardados en {OUTPUT_FILE}")

if __name__ == "__main__":
    fetch_and_process()
