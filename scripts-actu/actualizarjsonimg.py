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

# --- CONFIGURACIÓN GENERAL ---
IMG_DIR = "./img"
MAX_SIZE = (256, 256)
WEBP_QUALITY = 50

# --- LISTAS DE URLS ---
URLS_WEAPONS = [
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Arch-Gun.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Melee.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Primary.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Secondary.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/SentinelWeapons.json"
]

URLS_ENTITIES = [
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Warframes.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Archwing.json",
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Sentinels.json"
]

# --- FUNCIONES AUXILIARES ---

def clean_slug(text):
    if not text: return ""
    t = text.lower()
    t = re.sub(r'[\s\-\.]+', '_', t)
    t = re.sub(r'[^a-z0-9_]', '', t)
    return t.strip('_')

def clean_json_image_name(filename):
    if not filename: return None
    return re.sub(r'-[a-f0-9]+(\.[a-z]+)$', r'\1', filename)

def clean_dispo(val):
    try:
        v = float(val) if val is not None else 1.0
        return float(f"{v:.2f}")
    except:
        return 1.0

def get_simplified_relics(drops_list):
    """
    Extrae solo los nombres de las reliquias únicos.
    De: "Meso V11 Relic (Radiant)", "Meso V11 Relic (Intact)"
    A:  ["Meso V11"]
    """
    if not drops_list: return []
    unique_relics = set()

    # Patrón para capturar "Tier X1" ignorando "Relic", "(Radiant)", etc.
    # Soporta Lith, Meso, Neo, Axi, Requiem, Omnia
    relic_pattern = re.compile(r'(Lith|Meso|Neo|Axi|Requiem|Omnia)\s+([A-Z0-9]+)', re.IGNORECASE)

    for d in drops_list:
        loc = d.get('location', '')
        match = relic_pattern.search(loc)
        if match:
            # Formateamos bonito: "Meso V11" (Capitalizado y con espacio)
            relic_name = f"{match.group(1).title()} {match.group(2).upper()}"
            unique_relics.add(relic_name)

    # Devolvemos lista ordenada alfabéticamente
    return sorted(list(unique_relics))

def process_image(item_name, original_image_name_json, subdir):
    if not PILLOW_AVAILABLE: return None

    slug = clean_slug(item_name)
    if not slug: return None

    dest_dir = os.path.join(IMG_DIR, subdir)
    if not os.path.exists(dest_dir):
        os.makedirs(dest_dir)

    extensions = [".png", ".webp", ".jpg", ".jpeg"]
    found_src = None

    candidates = []
    if original_image_name_json:
        candidates.append(original_image_name_json)

    for ext in extensions:
        candidates.append(f"{slug}{ext}")

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
            if (f.startswith(slug) or f.startswith(slug_hyphen)) and any(f.endswith(ext) for ext in extensions):
                found_src = os.path.join(IMG_DIR, f)
                break

    if not found_src:
        return None

    try:
        dest_filename = f"{slug}.webp"
        dest_path = os.path.join(dest_dir, dest_filename)

        if os.path.exists(dest_path):
            return f"{subdir}/{dest_filename}"

        with Image.open(found_src) as img:
            img.thumbnail(MAX_SIZE)
            img.save(dest_path, "WEBP", quality=WEBP_QUALITY, optimize=True)
            # print(f"[OPTIMIZADO] {os.path.basename(found_src)} -> {subdir}/{dest_filename}") # Comentado para menos ruido
            return f"{subdir}/{dest_filename}"

    except Exception as e:
        print(f"Error procesando imagen {slug}: {e}")
        return None

def process_components(components, subdir):
    clean_comps = []
    if components:
        for comp in components:
            # Procesar imagen
            comp_local = process_image(comp.get("name"), comp.get("imageName"), subdir)
            comp_clean_name = clean_json_image_name(comp.get("imageName"))

            # Procesar drops (SIMPLIFICACIÓN MASIVA AQUI)
            # Solo obtenemos la lista de strings de reliquias, nada de objetos complejos
            simple_drops = get_simplified_relics(comp.get("drops", []))

            comp_data = {
                "name": comp.get("name"),
                "itemCount": comp.get("itemCount"),
                "drops": simple_drops, # Ahora es una lista simple: ["Meso V1", "Neo K4"]
                "ducats": comp.get("ducats", 0),
                "localImage": comp_local
            }

            if comp_clean_name and not comp_clean_name.endswith('.png'):
                comp_data["imageName"] = comp_clean_name

            clean_comps.append(comp_data)
    return clean_comps

# --- LOOP PRINCIPAL GENERIICO ---
def process_data(urls, subdir, output_file, is_weapon=False):
    print(f"--- PROCESANDO {subdir.upper()} ---")
    all_items = []

    for url in urls:
        try:
            print(f"Descargando: {url.split('/')[-1]}...")
            req = urllib.request.Request(url, headers={'User-Agent': 'Python-Script'})
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())

                for item in data:
                    if item.get("productCategory") == "SpaceSuits": continue

                    local_path = process_image(item.get("name"), item.get("imageName"), subdir)
                    cleaned_image_name = clean_json_image_name(item.get("imageName"))
                    clean_comps = process_components(item.get("components"), subdir)

                    cleaned_item = {
                        "name": item.get("name"),
                        "type": item.get("type"),
                        "category": item.get("category"),
                        "isPrime": item.get("isPrime", False),
                        "vaulted": item.get("vaulted"),
                        "masteryReq": item.get("masteryReq", 0),
                        "components": clean_comps,
                        "localImage": local_path
                    }

                    # Solo las armas llevan disposición riven
                    if is_weapon:
                        cleaned_item["omegaAttenuation"] = clean_dispo(item.get("omegaAttenuation"))

                    if cleaned_image_name and not cleaned_image_name.endswith('.png'):
                        cleaned_item["imageName"] = cleaned_image_name

                    all_items.append(cleaned_item)

        except Exception as e:
            print(f"Error en {url}: {e}")

    with open(output_file, "w", encoding='utf-8') as f:
        # Separators elimina espacios en blanco para minificar al máximo
        json.dump(all_items, f, separators=(',', ':'))
    print(f"Guardado en {output_file} (Tamaño optimizado)\n")

if __name__ == "__main__":
    # Procesar Armas
    process_data(URLS_WEAPONS, "weapons", "cleaned_weapons.json", is_weapon=True)

    # Procesar Entidades (Warframes, Archwings, etc)
    process_data(URLS_ENTITIES, "entities", "cleaned_entities.json", is_weapon=False)

    print("--- TODO LISTO ---")
