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

# Directorio del build local de WFCD (fetcha directo de DE, más fresco que el CDN de GitHub)
WFCD_LOCAL = os.path.join(os.path.dirname(__file__), "../../scripts-wfcd/warframe-items/data/json")

FILES_WEAPONS  = ["Arch-Gun", "Melee", "Primary", "Secondary", "SentinelWeapons"]
FILES_ENTITIES = ["Warframes", "Archwing", "Sentinels"]

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
def process_data(files, subdir, output_file, is_weapon=False):
    print(f"--- PROCESANDO {subdir.upper()} ---")
    all_items = []

    for name in files:
        local_path = os.path.join(WFCD_LOCAL, f"{name}.json")
        try:
            print(f"Leyendo: {name}.json...")
            with open(local_path, encoding='utf-8') as f:
                data = json.load(f)

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
            print(f"Error en {name}.json: {e}")

    with open(output_file, "w", encoding='utf-8') as f:
        # Separators elimina espacios en blanco para minificar al máximo
        json.dump(all_items, f, separators=(',', ':'))
    print(f"Guardado en {output_file} (Tamaño optimizado)\n")

# Kitgun chambers: viven en Misc.json (category=Misc), no en Primary/Secondary, así que el loop
# normal no los coge. Los inyectamos leyendo su disposición real de All.json.
KITGUN_CHAMBERS = {"Catchmoon", "Gaze", "Rattleguts", "Tombfinger", "Sporelacer", "Vermisplicer"}

def inject_kitguns(output_file, subdir="weapons"):
    try:
        with open(os.path.join(WFCD_LOCAL, "All.json"), encoding="utf-8") as f:
            allitems = json.load(f)
    except Exception as e:
        print(f"No se pudieron inyectar kitguns (All.json): {e}")
        return

    # Un chamber por nombre, el que tenga disposición numérica (descarta el emote 'Gaze').
    picked = {}
    for it in allitems:
        n = it.get("name")
        if n in KITGUN_CHAMBERS and isinstance(it.get("omegaAttenuation"), (int, float)):
            picked[n] = it

    with open(output_file, encoding="utf-8") as f:
        weapons = json.load(f)
    existing = {w.get("name") for w in weapons}

    added = 0
    for n, it in picked.items():
        if n in existing:
            continue
        weapons.append({
            "name": n,
            "type": "Pistol",          # kitgun = arma de fuego: usa stats de pistola en la tasación
            "category": "Secondary",
            "isPrime": False,
            "vaulted": None,
            "masteryReq": it.get("masteryReq", 0),
            "components": [],
            "localImage": process_image(n, it.get("imageName"), subdir),
            "omegaAttenuation": clean_dispo(it.get("omegaAttenuation")),
        })
        added += 1

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(weapons, f, separators=(",", ":"))
    print(f"Kitguns inyectados en {output_file}: {added}")


if __name__ == "__main__":
    # Procesar Armas
    process_data(FILES_WEAPONS, "weapons", "cleaned_weapons.json", is_weapon=True)

    # Inyectar kitguns (no están en las categorías estándar de WFCD)
    inject_kitguns("cleaned_weapons.json")

    # Procesar Entidades (Warframes, Archwings, etc)
    process_data(FILES_ENTITIES, "entities", "cleaned_entities.json", is_weapon=False)

    print("--- TODO LISTO ---")
