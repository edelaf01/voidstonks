import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import pandas as pd

MODULE_PATH = Path(__file__).resolve().parent / "curiosidades_gen.py"
spec = importlib.util.spec_from_file_location("curiosidades_gen", MODULE_PATH)
cg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cg)


class TestCuriosidadesGen(unittest.TestCase):
    def test_pop_de_formula_y_casos_limite(self):
        self.assertEqual(cg._pop_de({"liquidity_score": 50, "wfm_market_sample": 0}), 0.0)
        p = {"liquidity_score": 25, "wfm_market_sample": 2}
        expected = (25 - 0.5 - 1.5 * 2) / 5
        self.assertAlmostEqual(cg._pop_de(p), expected)

    def test_pop_de_puede_ser_negativo_y_campos_faltantes(self):
        self.assertAlmostEqual(cg._pop_de({}), -0.1)
        self.assertLess(cg._pop_de({"liquidity_score": 0, "wfm_market_sample": 5}), 0)
        self.assertAlmostEqual(
            cg._pop_de({"liquidity_score": None, "wfm_market_sample": None}), -0.1
        )

    def test_prima_de_filtros_y_respaldo(self):
        self.assertIsNone(cg._prima_de({"official_median": 0, "rerolled_premium_ratio": 2.5}))
        self.assertIsNone(cg._prima_de({"official_median": 100, "rerolled_premium_ratio": 0}))
        self.assertIsNone(cg._prima_de({"official_median": 100, "rerolled_premium_ratio": -1}))
        self.assertIsNone(cg._prima_de({"official_median": 100, "rerolled_premium_ratio": 1}))
        self.assertEqual(
            cg._prima_de({"official_median": 100, "rerolled_premium_ratio": 2.5, "wfm_avg_price": 400}),
            2.5
        )
        self.assertIsNone(
            cg._prima_de({"official_median": 100, "rerolled_premium_ratio": 4.0, "wfm_avg_price": 400})
        )
        self.assertIsNone(
            cg._prima_de({"official_median": 100, "rerolled_premium_ratio": 1.5})
        )

    def test_prima_de_ratio_menor_que_uno(self):
        self.assertEqual(
            cg._prima_de({"official_median": 100, "rerolled_premium_ratio": 0.8}),
            0.8
        )

    def test_fechas_weekly_umbral_cincuenta_armas(self):
        today = pd.Timestamp.now("UTC").date()
        d0 = str(today - pd.Timedelta(days=14))
        d1 = str(today - pd.Timedelta(days=7))
        d2 = str(today)

        series_49 = {
            f"arma_{i}": [
                {"date": d0, "official_median": 50},
                {"date": d1, "official_median": 70},
            ]
            for i in range(49)
        }
        self.assertEqual(cg._fechas_weekly(series_49), [])

        series_50 = {
            f"arma_{i}": [
                {"date": d0, "official_median": 50},
                {"date": d1, "official_median": 70},
            ]
            for i in range(50)
        }
        self.assertEqual(cg._fechas_weekly(series_50), [d1])

        series_ordenadas = dict(series_50)
        for i in range(50):
            series_ordenadas[f"arma_{i}"].append({"date": d2, "official_median": 90})
        self.assertEqual(cg._fechas_weekly(series_ordenadas), [d1, d2])

    def test_sin_variantes_elimina_variantes_con_misma_firma(self):
        firmas = {
            "braton": ("subida_venta", "2026-10-01", 50, 80),
            "braton prime": ("subida_venta", "2026-10-01", 50, 80),
        }
        self.assertEqual(cg._sin_variantes(firmas), {"braton"})

    def test_sin_variantes_conserva_mk1_y_firmas_distintas(self):
        firmas_mk1 = {
            "braton": ("subida_venta", "2026-10-01", 50, 80),
            "mk1-braton": ("subida_venta", "2026-10-01", 50, 80),
        }
        self.assertEqual(cg._sin_variantes(firmas_mk1), {"braton", "mk1-braton"})

        firmas_distintas = {
            "braton": ("subida_venta", "2026-10-01", 50, 80),
            "braton prime": ("bajada_venta", "2026-10-01", 80, 50),
        }
        self.assertEqual(cg._sin_variantes(firmas_distintas), {"braton", "braton prime"})

    def test_generar_curiosidades_fichero_inexistente_o_corrupto(self):
        self.assertEqual(cg._generar_curiosidades("no_existe.json"), [])
        with tempfile.TemporaryDirectory() as tmpdir:
            corrupto = os.path.join(tmpdir, "corrupto.json")
            with open(corrupto, "w", encoding="utf-8") as f:
                f.write("esto no es json")
            self.assertEqual(cg._generar_curiosidades(corrupto), [])

    def test_generar_curiosidades_minimo_puntos_y_cambio_de_de(self):
        today = pd.Timestamp.now("UTC").date()
        dates_9 = [str(today - pd.Timedelta(days=10 - i)) for i in range(9)]
        dates_11 = [str(today - pd.Timedelta(days=12 - i)) for i in range(11)]

        series_9 = {
            "braton": [
                {"date": d, "official_median": 50 if i < 5 else 100, "liquidity_score": 30, "wfm_market_sample": 1}
                for i, d in enumerate(dates_9)
            ]
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "s.json")
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_9, f)
            self.assertEqual(cg._generar_curiosidades(ruta), [])

            series_plana = {
                "braton": [
                    {"date": d, "official_median": 100, "liquidity_score": 30, "wfm_market_sample": 1}
                    for d in dates_11
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_plana, f)
            self.assertEqual(cg._generar_curiosidades(ruta), [])

    def test_generar_curiosidades_umbrales_precio_y_popularidad(self):
        today = pd.Timestamp.now("UTC").date()
        dates = [str(today - pd.Timedelta(days=12 - i)) for i in range(11)]

        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "s.json")

            series_precio_bajo = {
                "braton": [
                    {"date": d, "official_median": 20 if i < 7 else 38, "liquidity_score": 30, "wfm_market_sample": 1}
                    for i, d in enumerate(dates)
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_precio_bajo, f)
            self.assertEqual(cg._generar_curiosidades(ruta), [])

            series_pop_baja = {
                "braton": [
                    {"date": d, "official_median": 50 if i < 7 else 100, "liquidity_score": 5, "wfm_market_sample": 3}
                    for i, d in enumerate(dates)
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_pop_baja, f)
            self.assertEqual(cg._generar_curiosidades(ruta), [])

    def test_generar_curiosidades_clasificacion_subida_y_bajada(self):
        today = pd.Timestamp.now("UTC").date()
        dates = [str(today - pd.Timedelta(days=12 - i)) for i in range(11)]

        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "s.json")

            series_24 = {
                "braton": [
                    {"date": d, "official_median": 100 if i < 7 else 124, "liquidity_score": 30, "wfm_market_sample": 1}
                    for i, d in enumerate(dates)
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_24, f)
            self.assertEqual(cg._generar_curiosidades(ruta), [])

            series_25_sube = {
                "braton": [
                    {"date": d, "official_median": 100 if i < 7 else 125, "liquidity_score": 30, "wfm_market_sample": 1}
                    for i, d in enumerate(dates)
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_25_sube, f)
            res_sube = cg._generar_curiosidades(ruta)
            self.assertEqual(len(res_sube), 1)
            self.assertEqual(res_sube[0]["tipo"], "subida_venta")
            self.assertEqual(res_sube[0]["pct"], 25)

            series_25_baja = {
                "braton": [
                    {"date": d, "official_median": 100 if i < 7 else 75, "liquidity_score": 30, "wfm_market_sample": 1}
                    for i, d in enumerate(dates)
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_25_baja, f)
            res_baja = cg._generar_curiosidades(ruta)
            self.assertEqual(len(res_baja), 1)
            self.assertEqual(res_baja[0]["tipo"], "bajada_venta")
            self.assertEqual(res_baja[0]["pct"], -25)

    def test_generar_curiosidades_volatil_condiciones_y_prioridad(self):
        today = pd.Timestamp.now("UTC").date()
        dates = [str(today - pd.Timedelta(days=15 - i)) for i in range(12)]

        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "s.json")

            series_vol = {
                "braton": [
                    {
                        "date": d,
                        "official_median": 100,
                        "volatility_index": 2 if i < 7 else 16,
                        "liquidity_score": 30,
                        "wfm_market_sample": 1,
                    }
                    for i, d in enumerate(dates[:11])
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_vol, f)
            res_vol = cg._generar_curiosidades(ruta)
            self.assertEqual(len(res_vol), 1)
            self.assertEqual(res_vol[0]["tipo"], "volatil")

            series_doble = {
                "braton": [
                    {
                        "date": d,
                        "official_median": 100 if i < 8 else 180,
                        "volatility_index": 2 if i < 7 else 16,
                        "liquidity_score": 30,
                        "wfm_market_sample": 1,
                    }
                    for i, d in enumerate(dates[:10])
                ]
            }
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series_doble, f)
            res_doble = cg._generar_curiosidades(ruta)
            self.assertEqual(len(res_doble), 1)
            self.assertEqual(res_doble[0]["tipo"], "subida_venta")

    def test_generar_curiosidades_un_evento_por_arma_y_corte_recencia(self):
        today = pd.Timestamp.now("UTC").date()
        dates = [str(today - pd.Timedelta(days=40 - i)) for i in range(25)]

        series = {
            "braton": [
                {
                    "date": d,
                    "official_median": 100 if i < 7 else (150 if i < 15 else 220),
                    "liquidity_score": 30,
                    "wfm_market_sample": 1,
                }
                for i, d in enumerate(dates)
            ]
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "s.json")
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series, f)
            res = cg._generar_curiosidades(ruta)
            self.assertEqual(len(res), 1)

            res_corto = cg._generar_curiosidades(ruta, dias_max=3)
            self.assertEqual(len(res_corto), 0)

    def test_generar_curiosidades_ordenacion_ronda_y_claves_de(self):
        today = pd.Timestamp.now("UTC").date()
        dates = [str(today - pd.Timedelta(days=12 - i)) for i in range(13)]

        series = {
            "arma_sube_hoy": [
                {"date": d, "official_median": 100 if i < 12 else 180, "liquidity_score": 30, "wfm_market_sample": 1}
                for i, d in enumerate(dates)
            ],
            "arma_sube_ayer_fuerte": [
                {"date": d, "official_median": 100 if i < 11 else 200, "liquidity_score": 30, "wfm_market_sample": 1}
                for i, d in enumerate(dates)
            ],
            "arma_bajada_hoy": [
                {"date": d, "official_median": 100 if i < 12 else 60, "liquidity_score": 30, "wfm_market_sample": 1}
                for i, d in enumerate(dates)
            ],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "s.json")
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(series, f)
            res = cg._generar_curiosidades(ruta)
            self.assertGreaterEqual(len(res), 2)

            claves_prohibidas = {"ask_pct", "ask_de", "ask_a", "venta_pct", "venta_de", "venta_a", "ofertas", "solo_ask"}
            for e in res:
                self.assertEqual(e["fuente"], "de")
                for k in claves_prohibidas:
                    self.assertNotIn(k, e)

            subidas = [e for e in res if e["tipo"] == "subida_venta"]
            self.assertEqual(len(subidas), 2)
            self.assertEqual(subidas[0]["arma"], "arma_sube_hoy")
            self.assertEqual(subidas[1]["arma"], "arma_sube_ayer_fuerte")

    def test_generar_globales_sin_publicaciones_devuelve_vacio(self):
        self.assertEqual(cg._generar_globales({}), [])
        series_incompleta = {
            "arma": [{"date": "2026-10-01", "official_median": 50}]
        }
        self.assertEqual(cg._generar_globales(series_incompleta), [])

    def test_generar_globales_weekly_prima_y_cara(self):
        today = pd.Timestamp.now("UTC").date()
        d0 = str(today - pd.Timedelta(days=7))
        d1 = str(today - pd.Timedelta(days=1))
        d2 = str(today)

        series = {}
        for i in range(55):
            series[f"filler_{i}"] = [
                {"date": d0, "official_median": 50, "liquidity_score": 30, "wfm_market_sample": 1},
                {"date": d1, "official_median": 70, "liquidity_score": 30, "wfm_market_sample": 1, "rerolled_premium_ratio": 2.5, "wfm_avg_price": 400},
                {"date": d2, "official_median": 90, "liquidity_score": 30, "wfm_market_sample": 1, "rerolled_premium_ratio": 2.5, "wfm_avg_price": 400},
            ]

        series["braton"] = [
            {"date": d0, "official_median": 50, "liquidity_score": 30, "wfm_market_sample": 1},
            {"date": d1, "official_median": 80, "liquidity_score": 30, "wfm_market_sample": 1, "rerolled_premium_ratio": 2.5, "wfm_avg_price": 400},
            {"date": d2, "official_median": 80, "liquidity_score": 30, "wfm_market_sample": 1, "rerolled_premium_ratio": 2.5, "wfm_avg_price": 400},
        ]
        series["braton prime"] = [
            {"date": d0, "official_median": 50, "liquidity_score": 30, "wfm_market_sample": 1},
            {"date": d1, "official_median": 80, "liquidity_score": 30, "wfm_market_sample": 1, "rerolled_premium_ratio": 2.5, "wfm_avg_price": 400},
            {"date": d2, "official_median": 80, "liquidity_score": 30, "wfm_market_sample": 1, "rerolled_premium_ratio": 2.5, "wfm_avg_price": 400},
        ]

        series["lato"] = [
            {"date": d0, "official_median": 50, "liquidity_score": 30, "wfm_market_sample": 1},
            {"date": d1, "official_median": 500, "liquidity_score": 30, "wfm_market_sample": 1},
            {"date": d2, "official_median": 500, "liquidity_score": 30, "wfm_market_sample": 1},
        ]
        series["latolargo"] = [
            {"date": d0, "official_median": 50, "liquidity_score": 30, "wfm_market_sample": 1},
            {"date": d1, "official_median": 500, "liquidity_score": 30, "wfm_market_sample": 1},
            {"date": d2, "official_median": 500, "liquidity_score": 30, "wfm_market_sample": 1},
        ]

        gl = cg._generar_globales(series)
        tipos = {g["tipo"]: g for g in gl}
        self.assertIn("global_weekly", tipos)
        self.assertIn("global_prima", tipos)
        self.assertIn("global_cara", tipos)

        g_weekly = tipos["global_weekly"]
        self.assertEqual(g_weekly["desde"], d1)
        self.assertEqual(g_weekly["fecha"], d2)

        g_cara = tipos["global_cara"]
        self.assertEqual(g_cara["arma"], "lato")
        self.assertEqual(g_cara["valor"], 500)

        self.assertGreaterEqual(tipos["global_prima"]["armas"], 30)

    def test_generar_globales_prima_requiere_minimo_treinta_armas(self):
        today = pd.Timestamp.now("UTC").date()
        d0 = str(today - pd.Timedelta(days=7))
        d1 = str(today)

        series = {}
        for i in range(50):
            p = {"date": d1, "official_median": 70, "liquidity_score": 30, "wfm_market_sample": 1}
            if i < 29:
                p["rerolled_premium_ratio"] = 2.5
                p["wfm_avg_price"] = 400
            series[f"filler_{i}"] = [
                {"date": d0, "official_median": 50, "liquidity_score": 30, "wfm_market_sample": 1},
                p,
            ]
        gl = cg._generar_globales(series)
        tipos = {g["tipo"] for g in gl}
        self.assertNotIn("global_prima", tipos)

    def test_nota_formula_topes_y_bonificaciones(self):
        self.assertEqual(
            cg._nota({"pct": 500, "pop_de": 5}),
            cg._nota({"pct": 300, "pop_de": 5})
        )
        self.assertAlmostEqual(
            cg._nota({"pct": 100, "pop_de": 5, "tipo": "volatil"}),
            0.3 * cg._nota({"pct": 100, "pop_de": 5, "tipo": "subida_venta"})
        )
        self.assertEqual(cg._nota({"pct": 100, "pop_de": 0}), 0.0)
        expected = float(min(100, 300) * 1.0 * np.log1p(4) * 1.0)
        self.assertAlmostEqual(
            cg._nota({"pct": 100, "pop_de": 4}),
            expected
        )
        nota_bono = cg._nota({"pct": 100, "pop_de": 4, "dias_tras_weekly": 1})
        nota_sin_bono = cg._nota({"pct": 100, "pop_de": 4, "dias_tras_weekly": 3})
        self.assertAlmostEqual(nota_bono, 1.25 * nota_sin_bono)
        self.assertAlmostEqual(
            cg._nota({"pct": 100, "pop_de": 4, "dias_tras_weekly": 0}),
            1.25 * nota_sin_bono
        )
        self.assertAlmostEqual(
            cg._nota({"pct": 100, "pop_de": 4, "dias_tras_weekly": None}),
            nota_sin_bono
        )

    def test_fusiona_historial_filtra_legacy_y_resuelve_duplicados(self):
        today = pd.Timestamp.now("UTC").date()
        today_str = str(today)
        hace_2 = str(today - pd.Timedelta(days=2))
        hace_5 = str(today - pd.Timedelta(days=5))

        with tempfile.TemporaryDirectory() as tmpdir:
            ruta_previa = os.path.join(tmpdir, "curiosidades.json")
            previos = {
                "eventos": [
                    {"arma": "lato", "tipo": "especulacion", "fecha": hace_5, "pct": 50},
                    {"arma": "lex", "fuente": "wfm", "tipo": "subida_venta", "fecha": hace_5, "pct": 40},
                    {"arma": "torid", "fuente": "de", "tipo": "subida_venta", "fecha": hace_2, "pct": 30, "pop_de": 3.0},
                ]
            }
            with open(ruta_previa, "w", encoding="utf-8") as f:
                json.dump(previos, f)

            nuevos = [
                {"arma": "torid", "fuente": "de", "tipo": "subida_venta", "fecha": today_str, "pct": 50, "pop_de": 4.0},
                {"arma": "burston", "fuente": "de", "tipo": "volatil", "fecha": today_str, "pct": 40, "pop_de": 3.0},
            ]

            fusion = cg._fusiona_historial(nuevos, ruta_previa, dias_historial=60, tope=10)
            self.assertNotIn("lato", [e["arma"] for e in fusion])
            self.assertNotIn("lex", [e["arma"] for e in fusion])

            torid_ev = [e for e in fusion if e["arma"] == "torid"]
            self.assertEqual(len(torid_ev), 1)
            self.assertEqual(torid_ev[0]["fecha"], today_str)
            self.assertEqual(torid_ev[0]["pct"], 50)

            with open(ruta_previa, "w", encoding="utf-8") as f:
                f.write("{corrupt json...")
            fusion_corrupta = cg._fusiona_historial(nuevos, ruta_previa, dias_historial=60, tope=10)
            self.assertEqual(len(fusion_corrupta), 2)

    def test_fusiona_historial_un_evento_por_arma_y_tope(self):
        today = pd.Timestamp.now("UTC").date()
        today_str = str(today)
        ayer_str = str(today - pd.Timedelta(days=1))
        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "curiosidades.json")
            nuevos = [
                {"arma": "torid", "fuente": "de", "tipo": "subida_venta", "fecha": today_str, "pct": 50, "pop_de": 4.0},
                {"arma": "torid", "fuente": "de", "tipo": "bajada_venta", "fecha": ayer_str, "pct": -30, "pop_de": 4.0},
                {"arma": "burston", "fuente": "de", "tipo": "volatil", "fecha": today_str, "pct": 40, "pop_de": 3.0},
            ]
            fusion = cg._fusiona_historial(nuevos, ruta, dias_historial=60, tope=1)
            self.assertEqual(len(fusion), 1)
            fusion_todas = cg._fusiona_historial(nuevos, ruta, dias_historial=60, tope=10)
            armas = [e["arma"] for e in fusion_todas]
            self.assertEqual(len(armas), len(set(armas)))
            self.assertEqual(armas, ["torid", "burston"])
            fechas = [e["fecha"] for e in fusion_todas]
            self.assertEqual(fechas, sorted(fechas, reverse=True))

    def test_integracion_ejecucion_script_y_migracion(self):
        today = pd.Timestamp.now("UTC").date()
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            hist_file = tmp_path / "history_series.json"
            deploy_dir = tmp_path / "deploy"
            deploy_dir.mkdir(parents=True, exist_ok=True)
            curios_file = deploy_dir / "curiosidades.json"

            dates = [str(today - pd.Timedelta(days=12 - i)) for i in range(13)]
            series = {}
            for i in range(60):
                series[f"filler_{i}"] = [
                    {
                        "date": d,
                        "official_median": 50 if idx < 8 else 70,
                        "liquidity_score": 30,
                        "wfm_market_sample": 1,
                        "rerolled_premium_ratio": 2.5,
                        "wfm_avg_price": 400,
                    }
                    for idx, d in enumerate(dates)
                ]
            series["torid"] = [
                {
                    "date": d,
                    "official_median": 100 if idx < 8 else 180,
                    "liquidity_score": 35,
                    "wfm_market_sample": 1,
                }
                for idx, d in enumerate(dates)
            ]
            with open(hist_file, "w", encoding="utf-8") as f:
                json.dump(series, f)

            old_data = {
                "generado": str(today - pd.Timedelta(days=10)),
                "eventos": [
                    {
                        "arma": "lato",
                        "tipo": "especulacion",
                        "ask_pct": 80,
                        "fecha": str(today - pd.Timedelta(days=5)),
                    }
                ],
            }
            with open(curios_file, "w", encoding="utf-8") as f:
                json.dump(old_data, f)

            env = {
                **os.environ,
                "VOIDSTONKS_HIST_SERIES": str(hist_file),
                "DEPLOY_ML_DIR": str(deploy_dir),
            }
            res = subprocess.run(
                [sys.executable, "-P", "-E", str(MODULE_PATH)],
                env=env,
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=120,
            )
            self.assertEqual(res.returncode, 0, f"Error: {res.stderr}")
            self.assertTrue(curios_file.exists())
            with open(curios_file, "r", encoding="utf-8") as f:
                out = json.load(f)

            for key in ["generado", "serie_hasta", "globales", "eventos"]:
                self.assertIn(key, out)

            self.assertTrue(len(out["eventos"]) > 0)
            for ev in out["eventos"]:
                self.assertEqual(ev.get("fuente"), "de")
                self.assertNotIn("ask_pct", ev)
                self.assertNotEqual(ev.get("arma"), "lato")

            tipos_globales = {"global_weekly", "global_prima", "global_cara"}
            self.assertTrue(len(out["globales"]) > 0)
            for gl in out["globales"]:
                self.assertIn(gl.get("tipo"), tipos_globales)


if __name__ == "__main__":
    unittest.main()
