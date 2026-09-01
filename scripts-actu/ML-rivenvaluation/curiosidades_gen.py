"""Curiosidades de mercado para el carrusel del front.

Se separa de ML_local.py porque NO necesita el modelo: solo lee history_series.json. Así puede
correr a diario (los asks de WFM se mueven todos los días) en vez de esperar al reentreno semanal,
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


def _generar_curiosidades(path_series, top=40, dias_max=None):
    """Detecta movimientos de mercado de VARIOS tipos, no solo uno.

    Con un único tipo el carrusel repetía la misma frase 40 veces. Señal medida en el histórico:
    subida de venta real 1588 · bajada de venta 1324 · convergencia 754 · desplome de asks 509.
    """
    if not os.path.exists(path_series):
        return []
    try:
        with open(path_series, "r", encoding="utf-8") as f:
            series = json.load(f)
    except Exception as e:
        print(f"[WARN] curiosidades: no se pudo leer {path_series}: {e}")
        return []

    # Filtros contra el ruido: sin ellos salen +8829% de armas con 9 ofertas donde apareció una cara.
    MIN_OFERTAS, MIN_PRECIO, VENTANA = 12, 60, 7
    # Solo movimientos RECIENTES: el carrusel cuenta lo que está pasando, no lo que pasó en junio.
    # Sin este corte se ordenaba por magnitud y los mismos eventos viejos se quedaban fijos para
    # siempre por muy fresca que llegara la serie. Se mide contra la última fecha del propio
    # histórico (no contra "hoy") para que funcione igual si la serie se genera con retraso.
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
    _publicaciones = sorted(f for f, n in _cambios.items() if n >= 50)

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
        s = [p for p in serie if (p.get("wfm_avg_price") or 0) > 0]
        if len(s) < VENTANA + 3:
            continue
        s.sort(key=lambda p: p.get("date", ""))
        for i in range(VENTANA, len(s)):
            hoy = s[i]
            if _corte and (hoy.get("date") or "") < _corte:
                continue
            of = int(hoy.get("wfm_market_sample") or 0)
            if of < MIN_OFERTAS:
                continue
            prev = [p["wfm_avg_price"] for p in s[i - VENTANA:i] if p.get("wfm_avg_price")]
            if len(prev) < 4:
                continue
            base = float(np.median(prev))
            cur = float(hoy["wfm_avg_price"])
            if base < MIN_PRECIO or cur < MIN_PRECIO:
                continue
            ask_pct = (cur - base) / base * 100

            # DE publica SEMANAL sobre una serie diaria: official_median solo cambia el 13% de los
            # días. Un "+0%" sin comprobar que DE publicó significa "no hay dato", no "no se movió".
            pv = [p.get("official_median") or 0 for p in s[i - VENTANA:i + 1]]
            pv = [x for x in pv if x > 0]
            de_publico = len(set(pv)) >= 2 and len(pv) > 1
            base_v = float(np.median(pv[:-1])) if de_publico else 0.0
            cur_v = float(hoy.get("official_median") or 0)
            # Suelo también en la venta: sin él, DE pasando de 1p a 100p daba "+10420%", que es
            # ruido de una mediana calculada sobre dos ventas, no una revalorización.
            MIN_VENTA = 25
            venta_pct = (((cur_v - base_v) / base_v * 100)
                         if (base_v >= MIN_VENTA and cur_v >= MIN_VENTA) else None)

            tipo = None
            if venta_pct is not None and venta_pct >= 25 and abs(ask_pct) < 20:
                tipo = "convergencia"      # sube lo que se PAGA sin que suba lo que se pide
            elif venta_pct is not None and venta_pct >= 25:
                tipo = "subida_venta"      # se revaloriza de verdad
            elif venta_pct is not None and venta_pct <= -25:
                tipo = "bajada_venta"
            elif ask_pct <= -45:
                tipo = "desplome_ask"      # la burbuja se desinfla
            elif ask_pct >= 60 and venta_pct is not None and abs(venta_pct) < 15:
                tipo = "especulacion"      # piden más y nadie paga más (verificado)
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
                "ask_pct": round(ask_pct), "ask_de": round(base), "ask_a": round(cur),
                "venta_pct": (round(venta_pct) if venta_pct is not None else None),
                "venta_de": round(base_v) if base_v else None,
                "venta_a": round(cur_v) if cur_v else None,
                "ofertas": of,
                "solo_ask": tipo == "especulacion",
            })

    # Uno por arma, y luego repartido por tipo para que el carrusel no cuente 40 veces lo mismo.
    mejor = {}
    for e in eventos:
        k = e["arma"]
        if k not in mejor or abs(e["ask_pct"]) > abs(mejor[k]["ask_pct"]):
            mejor[k] = e
    por_tipo = {}
    for e in mejor.values():
        por_tipo.setdefault(e["tipo"], []).append(e)
    for lista in por_tipo.values():
        # Por FECHA primero: el carrusel cuenta lo que está pasando, así que lo de ayer manda sobre
        # un movimiento más aparatoso de hace tres semanas. La magnitud solo desempata dentro del
        # mismo día. Ordenar por magnitud dejaba arriba siempre los mismos eventos viejos.
        lista.sort(key=lambda e: (e["fecha"], max(abs(e["ask_pct"]), abs(e["venta_pct"] or 0))),
                   reverse=True)
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
    dias = {}
    for serie in series.values():
        for p in serie:
            d = p.get("date")
            if not d:
                continue
            e = dias.setdefault(d, {"ask": [], "venta": [], "of": 0})
            if (p.get("wfm_avg_price") or 0) > 0:
                e["ask"].append(float(p["wfm_avg_price"]))
            # official_median es la mediana de rivens SIN ROLAR (coincide con de_unrolled.median en
            # las 608 armas comprobadas), mientras que los asks de WFM son de rivens ROLADOS.
            # Compararlos daba una brecha de 26.5x que no significa nada: son productos distintos.
            # rerolled_premium_ratio (mediana 2.75) lleva el precio al mismo terreno y la brecha
            # honesta queda en 8.2x, que ya sí compara rolado contra rolado.
            _um = float(p.get("official_median") or 0)
            _pr = float(p.get("rerolled_premium_ratio") or 0)
            if _um > 0 and _pr > 0:
                e["venta"].append(_um * _pr)
            e["of"] += int(p.get("wfm_market_sample") or 0)
    fechas = sorted(dias)
    if len(fechas) < 8:
        return []

    out = []
    hoy, hace = dias[fechas[-1]], dias[fechas[-8]]
    # 1. La brecha entre lo que se pide y lo que se paga: el dato que más engaña al vendedor nuevo.
    if hoy["ask"] and hoy["venta"]:
        brecha = float(np.median(hoy["ask"])) / max(float(np.median(hoy["venta"])), 1)
        if brecha >= 2:
            out.append({"tipo": "global_brecha", "valor": round(brecha, 1),
                        "ask": round(float(np.median(hoy["ask"]))),
                        "venta": round(float(np.median(hoy["venta"]))),
                        "estimado": True})   # la venta de rolados es estimada, no observada
    # 2. Hacia dónde va el mercado esta semana (mediana de asks de todo el catálogo).
    if hoy["ask"] and hace["ask"]:
        a, b = float(np.median(hace["ask"])), float(np.median(hoy["ask"]))
        if a > 0 and abs((b - a) / a) >= 0.05:
            out.append({"tipo": "global_tendencia", "valor": round((b - a) / a * 100),
                        "de": round(a), "a": round(b)})
    # 3. Cuántas armas se mueven de verdad hoy.
    activas = sum(1 for serie in series.values()
                  if serie and (serie[-1].get("wfm_market_sample") or 0) >= 12)
    if activas:
        out.append({"tipo": "global_actividad", "valor": activas, "total": len(series)})
    # 4. El arma con más oferta viva: donde más competencia tienes si vendes.
    top = max(series.items(),
              key=lambda kv: (kv[1][-1].get("wfm_market_sample") or 0) if kv[1] else 0,
              default=(None, None))
    if top[0] and top[1] and (top[1][-1].get("wfm_market_sample") or 0) >= 20:
        out.append({"tipo": "global_saturada", "arma": top[0],
                    "valor": int(top[1][-1]["wfm_market_sample"])})
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
    venta = abs(e.get("venta_pct") or 0)
    ask = abs(e.get("ask_pct") or 0)
    # La venta real pesa más que el ask: pedir 3000p lo hace cualquiera, venderlo no.
    magnitud = max(venta * 1.5, ask)
    liquidez = np.log1p(e.get("ofertas") or 0)
    tras_weekly = e.get("dias_tras_weekly")
    bonus = 1.25 if (tras_weekly is not None and tras_weekly <= 2) else 1.0
    # solo_ask = no hubo ventas que lo respalden.
    castigo = 0.6 if e.get("solo_ask") else 1.0
    return float(magnitud * liquidez * bonus * castigo)


def _fusiona_historial(nuevos, ruta, dias_historial, tope):
    """Une lo detectado hoy con lo que ya hubiera, sin duplicados y con caducidad."""
    previos = []
    if os.path.exists(ruta):
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                previos = json.load(f).get("eventos") or []
        except (json.JSONDecodeError, OSError, ValueError):
            previos = []   # un fichero a medias no puede tumbar la generación del día

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
    return salida[:tope]


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
