package main

import (
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var recompensas = []panel{
	{X: 0.31, Y: 0.44, Bloques: []bloque{
		{Tipo: "estado", Texto: "5 en juego", Tono: "verde"},
		{Tipo: "separador"}, {Tipo: "precio", Plat: "2", Ducados: "15"},
	}},
	{X: 0.437, Y: 0.44, Borde: "valor", Bloques: []bloque{
		{Tipo: "chips", Chips: []chip{{Texto: "TE LLEVAS ≈5p", Tipo: "valor"}}},
		{Tipo: "chips", Chips: []chip{{Texto: "MÁS PLAT", Tipo: "pl"}, {Texto: "MÁS DUCADOS", Tipo: "duc"}}},
		{Tipo: "estado", Texto: "4 en juego", Tono: "verde"},
		{Tipo: "separador"}, {Tipo: "precio", Plat: "5", Ducados: "45"},
	}},
	{X: 0.563, Y: 0.44, Bloques: []bloque{
		{Tipo: "estado", Texto: "Crafted", Tono: "apagado"},
		{Tipo: "separador"}, {Tipo: "precio", Plat: "1", Ducados: "45"},
	}},
	{X: 0.69, Y: 0.44, Borde: "set", Bloques: []bloque{
		{Tipo: "chips", Chips: []chip{{Texto: "CIERRA SET · 65p", Tipo: "set"}}},
		{Tipo: "estado", Texto: "Juego: sin leer", Tono: "naranja"},
		{Tipo: "separador"}, {Tipo: "precio", Plat: "4", Ducados: "15"},
	}},
}

var kiosko = panel{X: 0.985, Y: 0.1, Anclaje: "derecha", Bloques: []bloque{
	{Tipo: "titulo", Texto: "Para echar · sin romper sets"},
	{Tipo: "lista", Filas: [][]parte{
		{{Texto: "2× Venato Prime Handle"}, {Texto: "3p", Tono: "cian"}, {Texto: "5.0 d/pl"}, {Texto: "30", Tono: "ducado"}},
		{{Texto: "1× Alternox Prime Blueprint"}, {Texto: "8p", Tono: "cian"}, {Texto: "12.5 d/pl"}, {Texto: "100", Tono: "ducado"}},
		{{Texto: "1× Vadarya Prime Receiver"}, {Texto: "2p", Tono: "cian"}, {Texto: "22.5 d/pl"}, {Texto: "45", Tono: "ducado"}},
	}},
}}

var rivenCiclo = panel{X: 0.015, Y: 0.2, Anclaje: "izquierda", Borde: "valor", Bloques: []bloque{
	{Tipo: "titulo", Texto: "Kuva Bramma", Tono: "cian"},
	{Tipo: "chips", Chips: []chip{{Texto: "NUEVO ES MEJOR", Tipo: "valor"}}},
	{Tipo: "separador"},
	{Tipo: "lista", Filas: [][]parte{
		{{Texto: "ACTUAL", Tono: "gris"}, {Texto: "~85p", Tono: "oro"}, {Texto: "63/100", Tono: "gris"}},
		{{Texto: "+120.5% Multishot", Tono: "verde"}, {Texto: "[A]", Tono: "gradoA"}},
		{{Texto: "+44.1% Cold", Tono: "verde"}, {Texto: "[C]", Tono: "gradoC"}},
		{{Texto: "-30% Zoom", Tono: "rojo"}},
	}},
	{Tipo: "separador"},
	{Tipo: "lista", Filas: [][]parte{
		{{Texto: "NUEVO", Tono: "verde"}, {Texto: "~120p", Tono: "oro"}, {Texto: "71/100", Tono: "gris"}},
		{{Texto: "+131.2% Critical Chance", Tono: "verde"}, {Texto: "[S]", Tono: "gradoS"}},
		{{Texto: "+98.4% Damage", Tono: "verde"}, {Texto: "[B]", Tono: "gradoB"}},
		{{Texto: "-18.2% Zoom", Tono: "rojo"}, {Texto: "[F]", Tono: "gradoF"}},
	}},
}}

func TestPanelesDentroDelJuegoYMismoAncho(t *testing.T) {
	juego := rectJuego{x: 100, y: 0, w: 2560, h: 1440}
	l := colocaPaneles(peticionPaneles{Grupo: "recompensas", Paneles: recompensas, MismoAncho: true}, juego)
	for i := 1; i < len(l); i++ {
		if l[i].img.Bounds().Dx() != l[0].img.Bounds().Dx() {
			t.Fatal("con mismoAncho todas miden lo mismo")
		}
	}
	e := estiloPara(juego.h)
	c := l[1].x + l[1].img.Bounds().Dx()/2
	if want := juego.x + int(0.437*float64(juego.w)); c < want-1 || c > want+1 {
		t.Fatalf("centro %d, quería %d", c, want)
	}
	k := colocaPaneles(peticionPaneles{Grupo: "kiosko", Paneles: []panel{kiosko}}, juego)[0]
	if der := k.x + k.img.Bounds().Dx() - e.margen; der != juego.x+int(0.985*float64(juego.w)) {
		t.Fatalf("anclado a la derecha en %d", der)
	}
}

func TestLasPildorasSalenEnVariasFilasSiNoCaben(t *testing.T) {
	e := estiloPara(1440)
	b := bloque{Tipo: "chips", Chips: []chip{{Texto: "MÁS PLAT", Tipo: "pl"}, {Texto: "MÁS DUCADOS", Tipo: "duc"}}}
	if n := len(e.filasChips(b, e.anchoBloque(b))); n != 1 {
		t.Fatalf("con su ancho caben en una: %d", n)
	}
	if n := len(e.filasChips(b, e.anchoBloque(b)/2)); n != 2 {
		t.Fatalf("a la mitad van en dos: %d", n)
	}
}

func TestNombreLargoSeRecorta(t *testing.T) {
	e := estiloPara(1440)
	if s := recorta(e.lista, "Akstiletto Prime Receiver Blueprint", 120); !strings.HasSuffix(s, "…") || anchoTexto(e.lista, s) > 120 {
		t.Fatalf("%q", s)
	}
}

func TestPanelesRechazaPeticionesMalas(t *testing.T) {
	for _, cuerpo := range []string{"no es json", `{"grupo":"Rec Ompensas","paneles":[]}`, `{"grupo":"x","paneles":[{},{},{},{},{},{},{},{},{}]}`} {
		w := httptest.NewRecorder()
		servirPaneles(w, httptest.NewRequest("POST", "/__voidstonks/paneles", strings.NewReader(cuerpo)))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%q: %d", cuerpo, w.Code)
		}
	}
}

func TestBGRAEsElMismoColorPremultiplicado(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.NRGBA{200, 100, 50, 128})
	p := img.Pix
	if b := bgraPremultiplicado(img); b[0] != p[2] || b[1] != p[1] || b[2] != p[0] || b[3] != 128 {
		t.Fatalf("%v de %v", b, p)
	}
}

func TestPanelesDeMuestraEnPNG(t *testing.T) {
	dir := os.Getenv("VS_PNG")
	if dir == "" {
		t.Skip("VS_PNG sin definir")
	}
	juego := rectJuego{w: 2560, h: 1440}
	lienzo := image.NewRGBA(image.Rect(0, 0, 2560, 1440))
	draw.Draw(lienzo, lienzo.Bounds(), image.NewUniform(color.RGBA{58, 52, 44, 255}), image.Point{}, draw.Src)
	for x := 0; x < 2560; x += 160 {
		draw.Draw(lienzo, image.Rect(x, 0, x+80, 1440), image.NewUniform(color.RGBA{96, 84, 60, 255}), image.Point{}, draw.Src)
	}
	todos := append(colocaPaneles(peticionPaneles{Grupo: "recompensas", Paneles: recompensas, MismoAncho: true}, juego),
		colocaPaneles(peticionPaneles{Grupo: "kiosko", Paneles: []panel{kiosko, rivenCiclo}}, juego)...)
	for _, p := range todos {
		draw.Draw(lienzo, p.img.Bounds().Add(image.Pt(p.x, p.y)), p.img, image.Point{}, draw.Over)
	}
	f, _ := os.Create(filepath.Join(dir, "paneles.png"))
	defer f.Close()
	png.Encode(f, lienzo)
}
