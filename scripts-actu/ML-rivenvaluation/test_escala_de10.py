import importlib.util
import json
import math
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parent / "escala_de10.py"
spec = importlib.util.spec_from_file_location("escala_de10", MODULE_PATH)
ed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ed)


class TestEscalaDe10(unittest.TestCase):
    def test_slug_normalizacion(self):
        self.assertEqual(ed.slug("Kuva Kohm"), "kuva_kohm")
        self.assertEqual(ed.slug("Cobra & Crane Prime"), "cobra_and_crane_prime")
        self.assertEqual(ed.slug("  Tenet Arca Plasmor  "), "tenet_arca_plasmor")
        self.assertEqual(ed.slug("MK1-Braton"), "mk1_braton")
        self.assertEqual(ed.slug("Dual---Skana"), "dual_skana")
        self.assertEqual(ed.slug("Rubico! Prime?"), "rubico_prime")
        self.assertEqual(ed.slug(""), "")

    def test_familia_zaw_alias_prefijos_sufijos_y_slugs(self):
        self.assertEqual(ed.familia("", set()), "")
        self.assertEqual(ed.familia(None, set()), "")
        self.assertEqual(ed.familia("kroostra", {"kroostra"}), "")
        self.assertEqual(ed.familia("plague_akwin", {"plague_akwin"}), "")
        self.assertEqual(ed.familia("vargeet_jai", {"vargeet_jai"}), "")
        self.assertEqual(ed.familia("dex_furis", {"furis"}), "furis")
        self.assertEqual(ed.familia("dex_afuris", {"afuris"}), "afuris")
        self.assertEqual(ed.familia("pangolin_prime", {"pangolin_sword"}), "pangolin_sword")
        self.assertEqual(ed.familia("prisma_dual_decurions", {"dual_decurion"}), "dual_decurion")
        self.assertEqual(ed.familia("kuva_kohm", {"kohm"}), "kohm")
        self.assertEqual(ed.familia("prisma_grakata_vandal", {"grakata"}), "grakata")
        self.assertEqual(ed.familia("tenet_coda_arca_scisco_prime", {"arca_scisco"}), "arca_scisco")
        self.assertEqual(ed.familia("kuva_kohm", {"braton"}), "kuva_kohm")
        self.assertEqual(ed.familia("torid", {"torid"}), "torid")
        self.assertEqual(ed.familia("torid", set()), "torid")

    def test_martes_fechas_y_cadenas_iso(self):
        self.assertEqual(ed.martes("2026-10-12"), "2026-10-06")
        self.assertEqual(ed.martes("2026-10-13"), "2026-10-13")
        self.assertEqual(ed.martes("2026-10-14"), "2026-10-13")
        self.assertEqual(ed.martes("2026-10-18"), "2026-10-13")
        self.assertEqual(ed.martes("2026-10-14T18:45:00+00:00"), "2026-10-13")
        self.assertEqual(ed.martes(date(2026, 10, 14)), "2026-10-13")

    def test_combinar_plataformas_promedios_min_max_mk1_y_separacion(self):
        listas = [
            [
                {"compatibility": "Kohm", "rerolled": True, "pop": 2.0, "median": 100, "stddev": 20, "min": 50, "max": 200},
                {"compatibility": "Kohm", "rerolled": False, "pop": 1.0, "median": 40, "stddev": 5, "min": 20, "max": 60},
                {"compatibility": "MK1-Braton", "rerolled": True, "pop": 5.0, "median": 20, "stddev": 5, "min": 10, "max": 30},
                {"compatibility": None, "rerolled": True, "pop": 1.0, "median": 10}
            ],
            [
                {"compatibility": "Kohm", "rerolled": True, "pop": 4.0, "median": 150, "stddev": 30, "min": 0, "max": 300},
                {"compatibility": "Braton MK-1", "rerolled": False, "pop": 5.0, "median": 20, "stddev": 5, "min": 10, "max": 30}
            ]
        ]
        res = ed.combinar_plataformas(listas)
        self.assertNotIn("MK1-Braton", res)
        self.assertNotIn("Braton MK-1", res)
        self.assertIn("Kohm", res)
        self.assertEqual(res["Kohm"]["rerolled"]["pop"], 3.0)
        self.assertEqual(res["Kohm"]["rerolled"]["median"], 125)
        self.assertEqual(res["Kohm"]["rerolled"]["stddev"], 25.0)
        self.assertEqual(res["Kohm"]["rerolled"]["min_price"], 50)
        self.assertEqual(res["Kohm"]["rerolled"]["max_price"], 300)
        self.assertEqual(res["Kohm"]["unrolled"]["pop"], 1.0)
        self.assertEqual(res["Kohm"]["unrolled"]["median"], 40)
        self.assertEqual(res["Kohm"]["unrolled"]["stddev"], 5.0)
        self.assertEqual(res["Kohm"]["unrolled"]["min_price"], 20)
        self.assertEqual(res["Kohm"]["unrolled"]["max_price"], 60)

    def test_fila_gestion_de_median_y_estructura(self):
        self.assertIsNone(ed.fila(None))
        self.assertIsNone(ed.fila({}))
        self.assertIsNone(ed.fila({"median": 0, "pop": 5}))
        self.assertIsNone(ed.fila({"median": -10, "pop": 5}))
        f = ed.fila({"median": 100, "pop": 2.5, "stddev": 15.2, "max_price": 400})
        self.assertEqual(f, [2.5, 100, 15.2, 400])
        f_min = ed.fila({"median": 100})
        self.assertEqual(f_min, [0, 100, 0, 0])

    def test_calcular_de10_ventana_encogimiento_tramos_pop10_y_nsem(self):
        u1 = (1 + math.sqrt(1 + 4 * (50 / 100) ** 2)) / 2
        u2 = (1 + math.sqrt(1 + 4 * (100 / 200) ** 2)) / 2
        l1 = math.log(100)
        l2 = math.log(200)
        s1 = math.sqrt(math.log(u1))
        s2 = math.sqrt(math.log(u2))
        mu_l_tramo1 = (l1 + l2) / 2
        mu_s_tramo1 = (s1 + s2) / 2
        l10_esperado = (2.0 * l1 + 3.0 * mu_l_tramo1) / (2.0 + 3.0)
        s10_esperado = (2.0 * s1 + 5.0 * mu_s_tramo1) / (2.0 + 5.0)

        serie_base = [
            {
                "semana": "2026-10-06",
                "de": {
                    "kohm": [2.0, 100, 50, 500],
                    "braton": [2.0, 200, 100, 600],
                    "medio": [20.0, 150, 40, 700],
                    "alto": [35.0, 300, 60, 1200]
                }
            }
        ]
        res = ed.calcular_de10(serie_base)
        self.assertEqual(res["semana"], "2026-10-06")
        self.assertEqual(res["familias"]["kohm"][0], round(l10_esperado, 3))
        self.assertEqual(res["familias"]["kohm"][1], round(s10_esperado, 3))
        self.assertEqual(res["familias"]["kohm"][2], 500)
        self.assertEqual(res["familias"]["kohm"][3], 0.2)
        self.assertEqual(res["familias"]["kohm"][4], 1)
        self.assertEqual(res["familias"]["medio"][3], 2.0)
        self.assertEqual(res["familias"]["alto"][3], 3.5)
        self.assertIn("<1.5", res["mu"]["l"])
        self.assertIn("1.5-3", res["mu"]["l"])
        self.assertIn(">=3", res["mu"]["l"])

        serie_larga = [
            {"semana": f"2026-01-{i:02d}", "de": {"kohm": [1.0, 100, 20, 300]}}
            for i in range(1, 13)
        ]
        res_larga = ed.calcular_de10(serie_larga)
        self.assertEqual(res_larga["semana"], "2026-01-12")
        self.assertEqual(res_larga["familias"]["kohm"][4], 10)
        self.assertEqual(res_larga["familias"]["kohm"][3], 1.0)

    def test_guardar_serie_tope_veintiseis_y_orden(self):
        serie_30 = [{"semana": f"2026-05-{i:02d}", "de": {}} for i in range(30, 0, -1)]
        with tempfile.TemporaryDirectory() as tmpdir:
            ruta = os.path.join(tmpdir, "serie.jsonl")
            guardada = ed.guardar_serie(ruta, serie_30)
            self.assertEqual(len(guardada), 26)
            self.assertEqual(guardada[0]["semana"], "2026-05-05")
            self.assertEqual(guardada[-1]["semana"], "2026-05-30")
            with open(ruta, encoding="utf-8") as f:
                lineas = [json.loads(line) for line in f if line.strip()]
            self.assertEqual(len(lineas), 26)
            self.assertEqual([s["semana"] for s in lineas], sorted(s["semana"] for s in lineas))

    def test_main_sin_red_creacion_serie_idempotencia_y_exit_sin_datos(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            f_armas = os.path.join(tmpdir, "armas.json")
            with open(f_armas, "w", encoding="utf-8") as f:
                json.dump([{"name": "Kohm"}], f)
            f_de = os.path.join(tmpdir, "de.json")
            with open(f_de, "w", encoding="utf-8") as f:
                json.dump([{"compatibility": "Kohm", "rerolled": True, "median": 100, "pop": 2, "stddev": 50, "min": 50, "max": 500}], f)
            f_serie = os.path.join(tmpdir, "serie.jsonl")
            f_salida = os.path.join(tmpdir, "de10.json")

            with patch.object(ed, "descargar", side_effect=AssertionError("Red no permitida")):
                sys.argv = ["escala_de10.py", "--de", f_de, "--serie", f_serie, "--salida", f_salida, "--armas", f_armas, "--semana", "2026-10-13"]
                ed.main()

                self.assertTrue(os.path.exists(f_serie))
                self.assertTrue(os.path.exists(f_salida))
                with open(f_serie, encoding="utf-8") as f:
                    lineas1 = [json.loads(l) for l in f if l.strip()]
                self.assertEqual(len(lineas1), 1)
                self.assertEqual(lineas1[0]["semana"], "2026-10-13")

                with open(f_salida, encoding="utf-8") as f:
                    de10_data = json.load(f)
                self.assertEqual(de10_data["semana"], "2026-10-13")
                self.assertIn("kohm", de10_data["familias"])

                sys.argv = ["escala_de10.py", "--de", f_de, "--serie", f_serie, "--salida", f_salida, "--armas", f_armas, "--semana", "2026-10-20"]
                ed.main()
                with open(f_serie, encoding="utf-8") as f:
                    lineas2 = [json.loads(l) for l in f if l.strip()]
                self.assertEqual(len(lineas2), 1)

                f_vacio = os.path.join(tmpdir, "vacio.json")
                with open(f_vacio, "w", encoding="utf-8") as f:
                    json.dump([], f)
                sys.argv = ["escala_de10.py", "--de", f_vacio, "--serie", f_serie, "--salida", f_salida, "--armas", f_armas]
                with self.assertRaises(SystemExit):
                    ed.main()

    def test_sembrar_carpeta_con_instantaneas(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            f_snap = os.path.join(tmpdir, "data_2026-10-15.json")
            with open(f_snap, "w", encoding="utf-8") as f:
                json.dump({"Kohm": {"de_rerolled": {"median": 100, "pop": 2, "stddev": 50, "max_price": 500}}}, f)
            serie = ed.sembrar(tmpdir, {"kohm"})
            self.assertEqual(len(serie), 1)
            self.assertEqual(serie[0]["semana"], "2026-10-13")
            self.assertIn("kohm", serie[0]["de"])
            self.assertEqual(serie[0]["de"]["kohm"], [2, 100, 50, 500])


if __name__ == "__main__":
    unittest.main()
