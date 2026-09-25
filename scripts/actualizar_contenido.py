#!/usr/bin/env python3
"""Añade lo nuevo de una update de Warframe a los datos que usa la app, sin regenerarlos: armas,
warframes, iconos, arcanos de Vosfor y versiones de caché. Lo ejecuta a diario .github/workflows/contenido.yml.

  python3 scripts/actualizar_contenido.py [--build | --local] [--simular]

Por defecto lee WFCD master (unos segundos). WFCD tarda ~1 día en recoger una update: --build compila
WFCD en local desde el Public Export de DE (~5 min) y --local reutiliza ese build.
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
REPO = AQUI.parent
JSON_DIR = REPO / "deploy/assets/json"
ICONOS = REPO / "deploy/assets/relic_contents"
RIVENS_SERVICE = REPO / "deploy/js/services/rivens/rivens.service.js"
ESTADO = AQUI / "contenido_pendiente.json"
WFCD_DIR = Path(os.environ.get("WFCD_DIR") or Path.home() / "Escritorio/scripts-wfcd/warframe-items")
WFCD_MASTER = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/"
CDN_IMG = "https://cdn.warframestat.us/img/"

CATS_ARMAS = ["Arch-Gun", "Melee", "Primary", "Secondary", "SentinelWeapons", "Arch-Melee"]
CATS_ENTIDADES = ["Warframes", "Archwing", "Sentinels"]
# Las que baja la app para las stats de combate (fetchWeaponCombatStats en rivens.service.js).
CATS_COMBATE = ["Primary", "Secondary", "Melee", "Arch-Gun", "SentinelWeapons"]
# Pistola del Drifter (Update 31): no admite riven y nunca ha estado en la lista.
OMITIR = {"Sirocco"}
RELIQUIA = re.compile(r"(Lith|Meso|Neo|Axi|Requiem|Omnia)\s+([A-Z0-9]+)", re.I)
FORMATOS = [{"indent": 1, "ensure_ascii": False}, {"separators": (",", ":"), "ensure_ascii": False}]

SIMULAR = "--simular" in sys.argv
LOCAL = "--build" in sys.argv or "--local" in sys.argv
DATA_DIR = WFCD_DIR / "data/json"  # con WFCD master, main() lo apunta a una carpeta temporal


def log(msg=""):
    print(msg, flush=True)


def descarga(url):
    req = urllib.request.Request(url, headers={"User-Agent": "voidstonks-actualizar"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def lee_json(p):
    texto = p.read_text(encoding="utf-8")
    datos = json.loads(texto)
    # Cada fichero tiene su formato (armas con sangría 1, el resto compacto): reescribirlo con
    # otro convierte un cambio de cuatro armas en un diff de 28.000 líneas.
    formato = next((f for f in FORMATOS if json.dumps(datos, **f) == texto), None)
    if formato is None:
        log(f"  aviso: formato de {p.name} no reconocido, se escribe con sangría 1")
    return datos, formato or FORMATOS[0]


def escribe_json(p, datos, formato):
    if not SIMULAR:
        p.write_text(json.dumps(datos, **formato), encoding="utf-8")


def slug(nombre):
    return re.sub(r"[^a-z0-9_]", "", re.sub(r"[\s\-.]+", "_", nombre.lower())).strip("_")


def dos_decimales(v):
    x = float(f"{float(v if v is not None else 1.0):.2f}")
    return int(x) if x.is_integer() else x  # el fichero escribe 1, no 1.0


def reliquias(drops):
    return sorted({f"{m.group(1).title()} {m.group(2).upper()}"
                   for d in drops or [] for m in [RELIQUIA.search(d.get("location", ""))] if m})


_COMPONENTES = None


def catalogo_componentes():
    # Desde el 24-09-2026 (WFCD #992) cada objeto trae sus componentes como {uniqueName, itemCount}:
    # nombre, ducados y drops viven en Components.json, y los recursos compartidos (Orokin Cell) en
    # Resources/Misc. Un build local anterior aún los trae completos y aquí no encuentra nada que hacer.
    global _COMPONENTES
    if _COMPONENTES is None:
        _COMPONENTES = {}
        for f in ("Resources", "Misc", "Components"):
            ruta = DATA_DIR / f"{f}.json"
            if ruta.exists():
                _COMPONENTES.update({x["uniqueName"]: x for x in json.loads(ruta.read_text(encoding="utf-8")) if x.get("uniqueName")})
    return _COMPONENTES


def expande(cs):
    out = []
    for c in cs or []:
        if not c.get("name"):
            ref = catalogo_componentes().get(c.get("uniqueName"))
            if not ref:
                continue
            c = {**ref, **c}
        out.append(c)
    return out


def lee_categoria(cat):
    datos = json.loads((DATA_DIR / f"{cat}.json").read_text(encoding="utf-8"))
    datos = [{**x, "components": expande(x.get("components"))} if x.get("components") else x for x in datos]
    if cat == "Arch-Melee":
        # WFCD mete aquí Corufell Prime por su ruta /Archwing/Melee/ (al Corufell base le hace la
        # excepción): productCategory "Melee" es un arma cuerpo a cuerpo normal, con riven.
        datos = [{**x, "type": "Melee", "category": "Melee"} for x in datos if x.get("productCategory") == "Melee"]
    return [x for x in datos if x.get("name") and x.get("productCategory") != "SpaceSuits"
            and "Sumdali" not in x["name"] and x["name"] not in OMITIR]


def por_nombre(items):
    m = {}
    for x in items:
        m.setdefault(x["name"].lower(), x)
    return m


def icono(nombre):
    return f"weapons/{slug(nombre)}.webp" if (ICONOS / f"{slug(nombre)}.webp").exists() else None


def crea_icono(item):
    destino = ICONOS / f"{slug(item['name'])}.webp"
    if destino.exists():
        return
    nombre = item.get("imageName")
    if not nombre:
        log(f"  aviso: WFCD no trae imagen de {item['name']}")
        return
    local = WFCD_DIR / "data/img" / nombre
    try:
        crudo = local.read_bytes() if local.exists() else descarga(CDN_IMG + nombre)
    except Exception as e:
        log(f"  aviso: sin imagen para {item['name']} ({e})")
        return
    log(f"  icono {destino.name}")
    if SIMULAR:
        return
    from PIL import Image
    im = Image.open(io.BytesIO(crudo)).convert("RGBA")
    im.thumbnail((128, 128), Image.LANCZOS)  # el tamaño de reducir_iconos.py
    im.save(destino, "WEBP", quality=90, method=6)


def componentes(cs, arma):
    out = []
    for c in cs or []:
        e = {"name": c["name"], "itemCount": c.get("itemCount") or 1, "drops": reliquias(c.get("drops")), "ducats": c.get("ducats") or 0}
        if arma:
            e["localImage"] = icono(c["name"])
        out.append(e)
    return out


def inserta(lista, e):
    clave = e["name"].casefold()
    i = next((k for k, x in enumerate(lista) if x.get("category") == e["category"] and x["name"].casefold() > clave), None)
    if i is None:
        misma = [k for k, x in enumerate(lista) if x.get("category") == e["category"]]
        i = misma[-1] + 1 if misma else len(lista)
    lista.insert(i, e)


def sincroniza(fichero, cats, arma):
    """Devuelve (nombres nuevos, hubo cambio de disposición)."""
    actual, formato = lee_json(fichero)
    origen = por_nombre([x for c in cats for x in lee_categoria(c)])
    mio = por_nombre(actual)
    hay_drops = any(c.get("drops") for x in origen.values() if x.get("isPrime") for c in x.get("components") or [])
    if not hay_drops:
        log("  aviso: el build no trae drops de reliquias (¿falló drops.warframestat.us?): no se tocan")
    dispos, vault, drops = [], [], set()

    # Todas las ocurrencias, no una por nombre: hay nombres repetidos (strikes de Zaw, Grimoire)
    # y la app lee la primera con .find.
    for e in actual:
        w = origen.get(e["name"].lower())
        if not w:
            continue
        if arma and w.get("omegaAttenuation") is not None and e.get("omegaAttenuation") != dos_decimales(w["omegaAttenuation"]):
            dispos.append(f"{e['name']}: {e.get('omegaAttenuation')} -> {dos_decimales(w['omegaAttenuation'])}")
            e["omegaAttenuation"] = dos_decimales(w["omegaAttenuation"])
        if not e.get("isPrime"):
            continue
        if w.get("vaulted") is not None and w["vaulted"] != e.get("vaulted"):
            vault.append(f"{e['name']}: {e.get('vaulted')} -> {w['vaulted']}")
            e["vaulted"] = w["vaulted"]
        nuevas = {c["name"]: reliquias(c.get("drops")) for c in w.get("components") or []}
        # Si el origen no trae ninguna reliquia para este ítem, se conserva lo que había.
        if hay_drops and any(nuevas.values()):
            for c in e.get("components") or []:
                if c["name"] in nuevas and c.get("drops") != nuevas[c["name"]]:
                    c["drops"] = nuevas[c["name"]]
                    drops.add(e["name"])

    nuevos = [w for k, w in origen.items() if k not in mio]
    for w in nuevos:
        crea_icono(w)
        e = {"name": w["name"], "type": w.get("type"), "category": w.get("category"), "isPrime": w.get("isPrime", False),
             # Un prime recién salido nunca está vaulted; WFCD deja null hasta que lo recoge la wiki.
             "vaulted": w["vaulted"] if w.get("vaulted") is not None else (False if w.get("isPrime") else None),
             "masteryReq": w.get("masteryReq", 0), "components": componentes(w.get("components"), arma)}
        if arma:
            e["localImage"] = icono(w["name"])
            e["omegaAttenuation"] = dos_decimales(w.get("omegaAttenuation"))
        else:
            e["lastPatch"] = (w.get("patchlogs") or [{}])[0].get("date")
        inserta(actual, e)

    log(f"  nuevos ({len(nuevos)}): {', '.join(w['name'] for w in nuevos) or '-'}")
    if arma:
        log(f"  disposiciones ({len(dispos)}): {'; '.join(dispos) or '-'}")
    log(f"  vaulted ({len(vault)}): {'; '.join(vault) or '-'}")
    log(f"  reliquias actualizadas ({len(drops)}): {', '.join(sorted(drops)) or '-'}")
    if nuevos or dispos or vault or drops:
        escribe_json(fichero, actual, formato)
    return [w["name"] for w in nuevos], bool(dispos)


def sincroniza_arcanos():
    sys.path.insert(0, str(AQUI))
    import generar_arcanos_vosfor as gen
    fichero = JSON_DIR / "arcanes_vosfor.json"
    actual, formato = lee_json(fichero)
    with tempfile.TemporaryDirectory() as tmp:
        gen.OUT = Path(tmp) / "arcanos.json"
        gen.main()
        nuevo = json.loads(gen.OUT.read_text(encoding="utf-8"))
    viejos = actual.get("arcanes", {})
    # Los campos puestos a mano (pix de The Hex) no los produce el generador: se conservan.
    nuevo["arcanes"] = {k: {**v, **{c: x for c, x in viejos.get(k, {}).items() if c not in v}} for k, v in nuevo["arcanes"].items()}
    if set(nuevo["others"]) == set(actual.get("others", [])):
        nuevo["others"] = actual["others"]
    claves = ["packs", "others", "arcanes"]
    if all(actual.get(k) == nuevo.get(k) for k in claves):
        log("  arcanos: sin cambios")
        return
    nuevos = sorted(set(nuevo["arcanes"]) - set(viejos))
    cambiados = sorted(k for k in set(nuevo["arcanes"]) & set(viejos) if nuevo["arcanes"][k] != viejos[k])
    log(f"  arcanos nuevos ({len(nuevos)}): {', '.join(nuevos) or '-'}")
    log(f"  arcanos con datos cambiados ({len(cambiados)}): {', '.join(cambiados) or '-'}")
    log(f"  colecciones: {len(actual.get('packs', []))} -> {len(nuevo['packs'])}")
    # hex_pix (la sección The Hex) se mantiene a mano: el generador no la produce.
    escribe_json(fichero, {**actual, **{k: nuevo[k] for k in claves}, "updated": nuevo["updated"]}, formato)


def sube_cache(clave):
    texto = RIVENS_SERVICE.read_text(encoding="utf-8")
    m = re.search(rf'"{clave}_v(\d+)"', texto)
    if not m:
        log(f"  aviso: no encuentro {clave} en rivens.service.js")
        return
    log(f"  {clave}: v{m.group(1)} -> v{int(m.group(1)) + 1}")
    if not SIMULAR:
        RIVENS_SERVICE.write_text(texto.replace(m.group(0), f'"{clave}_v{int(m.group(1)) + 1}"'), encoding="utf-8")


def caches(armas_nuevas, dispos, antes):
    """Devuelve las armas cuyas stats de combate aún no están en WFCD master."""
    if armas_nuevas or dispos:
        sube_cache("voidstonkscache_weapons")
    # Las stats de combate las baja la app de WFCD master, no de este build: su caché (una semana)
    # solo se sube cuando master ya tiene las armas, o el cliente guardaría otra vez la versión sin ellas.
    # Solo cuentan las que la app puede encontrar ahí: los kitguns no están en esas categorías.
    del_build = {x["name"] for c in CATS_COMBATE for x in lee_categoria(c)}
    en_master = del_build if not LOCAL else {x["name"] for c in CATS_COMBATE for x in json.loads(descarga(WFCD_MASTER + c + ".json"))}
    pendientes = sorted(del_build - en_master)
    llegadas = (antes - set(pendientes)) | (set(armas_nuevas) & en_master)
    if llegadas:
        log(f"  ya en WFCD master: {', '.join(sorted(llegadas))}")
        sube_cache("voidstonkscache_combat_stats")
    if pendientes:
        log(f"  stats de combate pendientes (WFCD master aún no las tiene): {', '.join(pendientes)}")
    return pendientes


def main():
    global DATA_DIR
    if LOCAL:
        if not (WFCD_DIR / "package.json").exists():
            sys.exit(f"No encuentro el clon de WFCD en {WFCD_DIR} (cámbialo con WFCD_DIR=...)")
        if "--build" in sys.argv:
            log(f"== Compilando WFCD desde el Public Export de DE ({WFCD_DIR}), unos minutos...")
            r = subprocess.run(["nice", "-n", "19", "npm", "run", "build"], cwd=WFCD_DIR, capture_output=True, text=True)
            if r.returncode != 0:
                sys.exit(f"Falló el build de WFCD (si DE cambió el formato, prueba `git -C {WFCD_DIR} pull`):\n{(r.stdout + r.stderr)[-3000:]}")
    else:
        DATA_DIR = Path(tempfile.mkdtemp(prefix="wfcd-"))
        log("== Descargando WFCD master")
        for cat in sorted(set(CATS_ARMAS + CATS_ENTIDADES + ["Components", "Resources", "Misc"])):
            (DATA_DIR / f"{cat}.json").write_bytes(descarga(WFCD_MASTER + cat + ".json"))
    if SIMULAR:
        log("== SIMULACIÓN: no se escribe nada")
    estado = json.loads(ESTADO.read_text(encoding="utf-8")) if ESTADO.exists() else {}
    log("== Armas (cleaned_weapons.json)")
    armas_nuevas, dispos = sincroniza(JSON_DIR / "cleaned_weapons.json", CATS_ARMAS, True)
    log("== Warframes, archwings y sentinels (cleaned_entities.json)")
    sincroniza(JSON_DIR / "cleaned_entities.json", CATS_ENTIDADES, False)
    log("== Arcanos de Vosfor (arcanes_vosfor.json)")
    sincroniza_arcanos()
    log("== Cachés de la app")
    combate = caches(armas_nuevas, dispos, set(estado.get("combate_pendiente", [])))
    if not SIMULAR:
        ESTADO.write_text(json.dumps({"combate_pendiente": combate}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    log()
    log("Hecho. A mano: revisa `git diff --stat`, pasa `npm test` y haz push a main (el worker lee")
    log("cleaned_weapons.json desde GitHub). El bot diario hace todo eso solo.")


if __name__ == "__main__":
    main()
