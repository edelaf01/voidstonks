"""Curiosidades de mercado para el carrusel del front.

Se separa de ML_local.py porque NO necesita el modelo: solo lee history_series.json. Así puede
correr a diario en vez de esperar al reentreno semanal,
que tarda ~20 min de XGBoost para algo que aquí son dos segundos.

Los eventos se ACUMULAN: cada ejecución añade lo que detecta hoy al fichero que ya había, en vez
de reemplazarlo. El carrusel es un historial de movimientos notables, no la foto del día — si un
arma se desplomó el martes eso sigue siendo interesante el jueves, y sustituyendo se perdía.

Uso:  python curiosidades_gen.py            -> escribe en $DEPLOY_ML_DIR (o ./generado)
Env:  CURIOS_DIAS=21              ventana de recencia para DETECTAR (cuánto atrás mirar)
      CURIOS_HISTORIAL_DIAS=60    cuánto se conserva en el historial
      CURIOS_MAX=240              tope de eventos guardados
      DEPLOY_ML_DIR               destino (en CI: deploy/assets/ml)
"""
import json
import os

import numpy as np
import pandas as pd

HIST_SERIES = os.environ.get("VOIDSTONKS_HIST_SERIES", "history_series.json")
MIN_VENTA = 40
POP_MIN = 2.0


def _pop_de(p):
    liq = p.get("liquidity_score") or 0
    of = p.get("wfm_market_sample") or 0
    if liq == 50 and of == 0:
        return 0.0
    return (liq - 0.5 - 1.5 * of) / 5


def _prima_de(p):
    om = p.get("official_median") or 0
    r = p.get("rerolled_premium_ratio") or 0
    if om <= 0 or r <= 0 or r == 1:
        return None
    respaldo = round(min(10.0, max(1.5, (p.get("wfm_avg_price") or om) / om)), 2)
    return None if abs(r - respaldo) < 0.006 else r


def _fechas_weekly(series):
    # Días en que DE publicó su tabla semanal: se detectan porque cientos de armas cambian de
    # official_median a la vez (medido: 379-401 armas los lunes 8, 15, 22 y 29 de junio). No hace
    # falta guardar un calendario aparte, la propia serie lo delata. Sirve para situar el evento:
    # un movimiento justo después de una publicación es reacción al dato nuevo, no ruido.
    _cambios = {}
    for _serie in series.values():
        _sv = sorted([p for p in _serie if (p.get("official_median") or 0) > 0],
                     key=lambda p: p.get("date", ""))
        for _a, _b in zip(_sv, _sv[1:]):
            if _a["official_median"] != _b["official_median"]:
                _cambios[_b["date"]] = _cambios.get(_b["date"], 0) + 1
    return sorted(f for f, n in _cambios.items() if n >= 50)


def _sin_variantes(firmas):
    grupos = {}
    for arma, f in firmas.items():
        grupos.setdefault(f, []).append(arma)
    return {a for a, f in firmas.items()
            if not any(o != a and f" {o} " in f" {a} " for o in grupos[f])}


def _generar_curiosidades(path_series, top=40, dias_max=None):
    """Detecta movimientos de mercado de VARIOS tipos, no solo uno.

    Con un único tipo el carrusel repetía la misma frase 40 veces.
    """
    if not os.path.exists(path_series):
        return []
    try:
        with open(path_series, "r", encoding="utf-8") as f:
            series = json.load(f)
    except Exception as e:
        print(f"[WARN] curiosidades: no se pudo leer {path_series}: {e}")
        return []

    VENTANA = 7
    # Solo movimientos RECIENTES: el carrusel cuenta lo que está pasando, no lo que pasó en junio.
    # Sin este corte se ordenaba por magnitud y los mismos eventos viejos se quedaban fijos para
    # siempre por muy fresca que llegara la serie. Se mide contra la última fecha del propio
    # histórico (no contra "hoy") para que funcione igual si la serie se genera con retraso.
    _publicaciones = _fechas_weekly(series)

    def _tras_publicacion(fecha):
        """Última publicación semanal anterior o igual a `fecha`, y días transcurridos."""
        previas = [f for f in _publicaciones if f <= fecha]
        if not previas:
            return None, None
        ult = previas[-1]
        return ult, (pd.Timestamp(fecha) - pd.Timestamp(ult)).days

    _dias = int(os.environ.get("CURIOS_DIAS", dias_max or 21))
    _ultima = max((p.get("date") or "" for serie in series.values() for p in serie), default="")
    _corte = ""
    if _ultima:
        _corte = str((pd.Timestamp(_ultima) - pd.Timedelta(days=_dias)).date())
    eventos = []
    for arma, serie in series.items():
        s = [p for p in serie if (p.get("official_median") or 0) > 0]
        if len(s) < VENTANA + 3:
            continue
        s.sort(key=lambda p: p.get("date", ""))
        for i in range(VENTANA, len(s)):
            hoy, ayer, previos = s[i], s[i - 1], s[i - VENTANA:i]
            if _corte and (hoy.get("date") or "") < _corte:
                continue
            pop = _pop_de(hoy)
            if pop < POP_MIN or float(np.median([_pop_de(p) for p in previos])) < POP_MIN:
                continue
            cur_v = float(hoy["official_median"])
            base_v = float(np.median([p["official_median"] for p in previos]))
            vol = float(hoy.get("volatility_index") or 0)
            base_vol = float(np.median([p.get("volatility_index") or 0 for p in previos]))

            tipo = None
            # DE publica SEMANAL sobre una serie diaria: official_median solo cambia el 13% de los
            # días. Un "+0%" sin comprobar que DE publicó significa "no hay dato", no "no se movió".
            # Suelo en la venta: sin él, DE pasando de 1p a 100p daba "+10420%", que es
            # ruido de una mediana calculada sobre dos ventas, no una revalorización.
            if cur_v != ayer["official_median"] and base_v >= MIN_VENTA and cur_v >= MIN_VENTA:
                pct = (cur_v - base_v) / base_v * 100
                if abs(pct) >= 25:
                    tipo = "subida_venta" if pct > 0 else "bajada_venta"
                    v_de, v_a = round(base_v), round(cur_v)
            if (not tipo and vol != float(ayer.get("volatility_index") or 0)
                    and cur_v >= MIN_VENTA and 0 < base_vol <= 6 and base_vol != 3.0 and vol >= 15):
                tipo = "volatil"
                pct = (vol - base_vol) / max(base_vol, 0.1) * 100
                v_de, v_a = round(base_vol / 10, 2), round(vol / 10, 1)
            if not tipo:
                continue

            # El movimiento no ocurre en un día: se compara la mediana de la VENTANA anterior contra
            # hoy. Guardar el tramo permite decir "entre el 10 y el 17 de junio", que es lo que
            # realmente se midió, en vez de fingir una fecha exacta.
            _desde = s[i - VENTANA].get("date")
            _pub, _tras = _tras_publicacion(hoy.get("date") or "")
            eventos.append({
                "weekly": _pub, "dias_tras_weekly": _tras,
                "arma": arma, "fecha": hoy.get("date"), "desde": _desde, "tipo": tipo,
                "pct": round(pct), "de": v_de, "a": v_a,
                "pop_de": round(pop, 1), "fuente": "de",
            })

    # Uno por arma, y luego repartido por tipo para que el carrusel no cuente 40 veces lo mismo.
    mejor = {}
    for e in eventos:
        k = e["arma"]
        peso = (e["tipo"] != "volatil", e["fecha"], abs(e["pct"]))
        if k not in mejor or peso > (mejor[k]["tipo"] != "volatil", mejor[k]["fecha"],
                                     abs(mejor[k]["pct"])):
            mejor[k] = e
    quedan = _sin_variantes({a: (e["tipo"], e["fecha"], e["de"], e["a"]) for a, e in mejor.items()})
    por_tipo = {}
    for e in mejor.values():
        if e["arma"] in quedan:
            por_tipo.setdefault(e["tipo"], []).append(e)
    for lista in por_tipo.values():
        # Por FECHA primero: el carrusel cuenta lo que está pasando, así que lo de ayer manda sobre
        # un movimiento más aparatoso de hace tres semanas. La magnitud solo desempata dentro del
        # mismo día. Ordenar por magnitud dejaba arriba siempre los mismos eventos viejos.
        lista.sort(key=lambda e: (e["fecha"], abs(e["pct"])), reverse=True)
    # La ronda arranca por el tipo que tiene el evento MÁS RECIENTE, no por orden alfabético.
    # El carrusel abre por la primera tarjeta, así que con el orden alfabético esa tarjeta era
    # la de "bajada_venta" aunque su evento fuera de ayer y hubiera uno de hoy en otro tipo.
    # El nombre del tipo se queda solo como desempate, para que la salida siga siendo determinista.
    orden = sorted(por_tipo, key=lambda t: (por_tipo[t][0]["fecha"], t), reverse=True)
    salida, i = [], 0
    while len(salida) < top and any(len(v) > i for v in por_tipo.values()):
        for tipo in orden:                     # ronda equitativa entre tipos
            if len(por_tipo[tipo]) > i and len(salida) < top:
                salida.append(por_tipo[tipo][i])
        i += 1
    return salida


def _generar_globales(series):
    """Datos del mercado ENTERO, no de un arma. El carrusel del índice los mezcla con los eventos
    para que no sean todo movimientos concretos: un "el 49% de lo que se vende lleva maldición"
    orienta más al que empieza que cualquier subida puntual.

    Todo se calcula del histórico; nada va escrito a mano.
    """
    publicaciones = _fechas_weekly(series)
    if not publicaciones:
        return []
    ult = publicaciones[-1]
    tanda = [f for f in publicaciones if (pd.Timestamp(ult) - pd.Timestamp(f)).days <= 2]
    out = []
    cambios, fiables = {}, {}
    for arma, serie in series.items():
        s = sorted([p for p in serie if (p.get("official_median") or 0) > 0],
                   key=lambda p: p.get("date", ""))
        if not s:
            continue
        antes = [p["official_median"] for p in s if p.get("date", "") < tanda[0]]
        tras = [p["official_median"] for p in s if tanda[0] <= p.get("date", "") <= ult]
        if antes and tras and tras[-1] != antes[-1]:
            cambios[arma] = (antes[-1], tras[-1])
        if s[-1]["official_median"] >= MIN_VENTA and _pop_de(s[-1]) >= POP_MIN:
            fiables[arma] = s[-1]
    quedan = _sin_variantes(cambios)
    suben = sum(1 for a in quedan if cambios[a][1] > cambios[a][0])
    bajan = len(quedan) - suben
    if suben + bajan:
        g = {"tipo": "global_weekly", "fecha": ult, "suben": suben, "bajan": bajan}
        if tanda[0] != ult:
            g["desde"] = tanda[0]
        out.append(g)
    fiables = {a: fiables[a] for a in _sin_variantes(
        {a: (p["official_median"], p.get("rerolled_premium_ratio")) for a, p in fiables.items()})}
    primas = [r for r in (_prima_de(p) for p in fiables.values()) if r is not None]
    if len(primas) >= 30:
        out.append({"tipo": "global_prima", "valor": round(float(np.median(primas)), 1),
                    "armas": len(primas)})
    if fiables:
        arma, p = max(fiables.items(),
                      key=lambda kv: (kv[1]["official_median"], -len(kv[0]), kv[0]))
        out.append({"tipo": "global_cara", "arma": arma, "valor": round(p["official_median"])})
    return out


# Un mismo movimiento se sigue detectando varios días seguidos (el desplome del martes sigue
# saliendo el miércoles con otra fecha). Guardarlos todos convierte el historial en un log
# repetido, así que del mismo (arma, tipo) se conserva solo la lectura más reciente dentro de
# esta ventana.
REPETIDO_DIAS = 7

# Lo de la última semana entra entero: es "lo que está pasando". De ahí hacia atrás el historial
# se queda solo con lo NOTABLE, porque el carrusel enseña una decena de tarjetas y guardar 300
# movimientos mediocres no los hace visibles, solo los entierra.
FRESCOS_DIAS = 7
ARCHIVO_MAX = 40


def _nota(e):
    """Cuánto merece sobrevivir un evento pasada la semana.

    Tres cosas lo hacen memorable y las tres están ya en el evento: cuánto se movió, en un arma
    que de verdad se comercia, y si fue pegado a la tabla semanal de DE (que es lo que convierte
    un vaivén en una reacción). Un -87% en un arma con 2 ofertas no es una noticia, es ruido.
    """
    magnitud = min(abs(e.get("pct") or 0), 300) * (0.3 if e.get("tipo") == "volatil" else 1.0)
    liquidez = np.log1p(e.get("pop_de") or 0)
    tras_weekly = e.get("dias_tras_weekly")
    bonus = 1.25 if (tras_weekly is not None and tras_weekly <= 2) else 1.0
    return float(magnitud * liquidez * bonus)


def _fusiona_historial(nuevos, ruta, dias_historial, tope):
    """Une lo detectado hoy con lo que ya hubiera, sin duplicados y con caducidad."""
    previos = []
    if os.path.exists(ruta):
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                previos = json.load(f).get("eventos") or []
        except (json.JSONDecodeError, OSError, ValueError):
            previos = []   # un fichero a medias no puede tumbar la generación del día
    previos = [e for e in previos if e.get("fuente") == "de"]

    hoy = pd.Timestamp.now("UTC").date()
    corte = str(hoy - pd.Timedelta(days=dias_historial))
    fusion, ultima = [], {}
    # Los de hoy primero: si un evento se redetecta, manda la lectura nueva.
    for e in [*nuevos, *previos]:
        fecha = e.get("fecha") or ""
        if fecha < corte:
            continue
        clave = (e.get("arma"), e.get("tipo"))
        anterior = ultima.get(clave)
        if anterior is not None and abs((pd.Timestamp(fecha) - pd.Timestamp(anterior)).days) < REPETIDO_DIAS:
            continue
        ultima[clave] = fecha
        fusion.append(e)
    # Curado: la semana entera, y del resto solo los más notables.
    frontera = str(hoy - pd.Timedelta(days=FRESCOS_DIAS))
    frescos = [e for e in fusion if (e.get("fecha") or "") >= frontera]
    archivo = [e for e in fusion if (e.get("fecha") or "") < frontera]
    archivo.sort(key=_nota, reverse=True)
    salida = frescos + archivo[:ARCHIVO_MAX]
    # Descendente por fecha (el front pinta el primero como "lo más reciente"); el orden por
    # fuerza de señal que trae el generador se conserva dentro de cada día porque sort es estable.
    salida.sort(key=lambda e: e.get("fecha") or "", reverse=True)
    # Un arma, una tarjeta: el mismo desplome vuelve a salir al día siguiente con otro tipo
    # (desplome_ask el 12, especulacion el 13) y el carrusel contaba dos veces lo mismo. Ya
    # está en orden por fecha, así que sobrevive la lectura más reciente.
    vistas, unicos = set(), []
    for e in salida:
        arma = str(e.get("arma") or "").lower()
        if arma in vistas:
            continue
        vistas.add(arma)
        unicos.append(e)
    return unicos[:tope]


if __name__ == "__main__":
    _ev = _generar_curiosidades(HIST_SERIES)
    with open(HIST_SERIES, "r", encoding="utf-8") as _f:
        _series = json.load(_f)
    _gl = _generar_globales(_series)
    _dest = os.environ.get("DEPLOY_ML_DIR", "generado")
    os.makedirs(_dest, exist_ok=True)
    _ruta = os.path.join(_dest, "curiosidades.json")
    _antes = len(_ev)
    _ev = _fusiona_historial(_ev, _ruta,
                             int(os.environ.get("CURIOS_HISTORIAL_DIAS", 60)),
                             int(os.environ.get("CURIOS_MAX", 240)))
    with open(_ruta, "w", encoding="utf-8") as f:
        # `serie_hasta` = último día del histórico del que salen los eventos. Va aparte de `generado`
        # a propósito: si la serie no se refresca, `generado` dice hoy y los eventos son de hace
        # semanas, y sin este campo el desfase no se ve sin abrir history_series.json.
        _hasta = max((p.get("date") or "" for s_ in _series.values() for p in s_), default="")
        json.dump({"generado": str(pd.Timestamp.now("UTC").date()), "serie_hasta": _hasta,
                   "globales": _gl, "eventos": _ev}, f, indent=1, ensure_ascii=False)
    from collections import Counter
    print(f"Curiosidades: {len(_ev)} eventos en el historial "
          f"({_antes} detectados hoy) + {len(_gl)} globales -> {_ruta}")
    if _ev:
        print("  por tipo:", dict(Counter(e["tipo"] for e in _ev)))
        print("  fechas  :", min(e["fecha"] for e in _ev), "->", max(e["fecha"] for e in _ev))
