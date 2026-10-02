package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gomedium"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
	"golang.org/x/image/webp"
)

// Paneles del overlay: la app manda bloques (título, píldoras, precio, lista…) y el lanzador los dibuja con
// los colores de la app encima del juego. Cada pantalla es un grupo que se sustituye entero.
type chip struct {
	Texto string `json:"texto"`
	Tipo  string `json:"tipo"` // valor | valor-justo | set | set-cerca | pl | duc
}

type parte struct {
	Texto string `json:"texto"`
	Tono  string `json:"tono"`
}

type bloque struct {
	Tipo    string    `json:"tipo"` // titulo | chips | estado | separador | precio | lista
	Texto   string    `json:"texto"`
	Tono    string    `json:"tono"`
	Chips   []chip    `json:"chips"`
	Plat    string    `json:"plat"`
	Ducados string    `json:"ducados"`
	Filas   [][]parte `json:"filas"`
}

type panel struct {
	X       float64  `json:"x"`
	Y       float64  `json:"y"`       // borde de arriba, en fracción del alto del juego
	Anclaje string   `json:"anclaje"` // qué borde cae en X: centro (por defecto), izquierda, derecha
	Borde   string   `json:"borde"`   // valor | pl | duc | set
	Bloques []bloque `json:"bloques"`
}

type peticionPaneles struct {
	Grupo      string  `json:"grupo"`
	Paneles    []panel `json:"paneles"`
	MismoAncho bool    `json:"mismoAncho"`
	DuracionMs int     `json:"duracionMs"` // <= 0: hasta que la app lo quite
}

type rectJuego struct{ x, y, w, h int }

type panelPintado struct {
	img  *image.RGBA
	x, y int // esquina en coordenadas de pantalla
}

var (
	reGrupo     = regexp.MustCompile(`^[a-z]{1,16}$`)
	muPaneles   sync.Mutex
	caducidades = map[string]*time.Timer{}
	firmas      = map[string]string{}
)

func quitaTodos() {
	muPaneles.Lock()
	defer muPaneles.Unlock()
	for _, g := range gruposVisibles() {
		quitaGrupo(g)
		delete(firmas, g)
	}
}

func peticionValida(p peticionPaneles) bool {
	if !reGrupo.MatchString(p.Grupo) || len(p.Paneles) > 8 {
		return false
	}
	for _, pn := range p.Paneles {
		filas := 0
		for _, b := range pn.Bloques {
			filas += len(b.Filas)
		}
		if len(pn.Bloques) > 30 || filas > 40 {
			return false
		}
	}
	return true
}

func servirPaneles(w http.ResponseWriter, r *http.Request) {
	var p peticionPaneles
	if r.Method != http.MethodPost || json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&p) != nil || !peticionValida(p) {
		http.Error(w, "POST {grupo, paneles}", http.StatusBadRequest)
		return
	}
	muPaneles.Lock()
	defer muPaneles.Unlock()
	if t := caducidades[p.Grupo]; t != nil {
		t.Stop()
		delete(caducidades, p.Grupo)
	}
	if len(p.Paneles) == 0 {
		quitaGrupo(p.Grupo)
		delete(firmas, p.Grupo)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	firma, _ := json.Marshal(struct {
		P []panel
		M bool
	}{p.Paneles, p.MismoAncho})
	if string(firma) != firmas[p.Grupo] || !grupoVisible(p.Grupo) {
		juego, err := ventanaDelJuego()
		if err == nil {
			err = muestraGrupo(p.Grupo, colocaPaneles(p, juego))
		}
		if err != nil {
			delete(firmas, p.Grupo)
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		firmas[p.Grupo] = string(firma)
	}
	if p.DuracionMs > 0 {
		grupo := p.Grupo
		caducidades[grupo] = time.AfterFunc(time.Duration(p.DuracionMs)*time.Millisecond, func() {
			muPaneles.Lock()
			defer muPaneles.Unlock()
			quitaGrupo(grupo)
		})
	}
	w.WriteHeader(http.StatusNoContent)
}

func colocaPaneles(p peticionPaneles, juego rectJuego) []panelPintado {
	e := estiloPara(juego.h)
	maximo := juego.w * 34 / 100
	anchos := make([]int, len(p.Paneles))
	comun := 0
	for i, pn := range p.Paneles {
		anchos[i] = min(maximo, e.anchoPanel(pn))
		comun = max(comun, anchos[i])
	}
	var out []panelPintado
	for i, pn := range p.Paneles {
		w := anchos[i]
		if p.MismoAncho {
			w = max(comun, juego.w/10)
		}
		img := e.dibujaPanel(pn, w)
		total := img.Bounds().Dx()
		x := juego.x + int(pn.X*float64(juego.w))
		switch pn.Anclaje {
		case "izquierda":
			x -= e.margen
		case "derecha":
			x -= total - e.margen
		default:
			x -= total / 2
		}
		x = max(juego.x-e.margen, min(x, juego.x+juego.w-total+e.margen))
		out = append(out, panelPintado{img: img, x: x, y: juego.y + int(pn.Y*float64(juego.h)) - e.margen})
	}
	return out
}

// Los colores de la app (css/components/modals.css y scanner.css).
var (
	fondoPanel = color.NRGBA{10, 15, 20, 245}
	bordeSuave = color.NRGBA{255, 255, 255, 51}
	tonos      = map[string]color.NRGBA{
		"blanco": {255, 255, 255, 255}, "gris": {138, 147, 160, 255}, "cian": {0, 229, 255, 255},
		"oro": {197, 168, 86, 255}, "ducado": {221, 170, 56, 255}, "verde": {0, 255, 120, 255},
		"morado": {162, 155, 254, 255}, "naranja": {224, 147, 47, 255}, "apagado": {136, 136, 136, 255},
		"rojo": {255, 107, 107, 255}, "gradoS": {255, 215, 0, 255}, "gradoA": {255, 140, 0, 255},
		"gradoB": {0, 229, 255, 255}, "gradoC": {168, 121, 236, 255}, "gradoF": {255, 77, 77, 255},
	}
	tonoDeBorde = map[string]string{"valor": "verde", "pl": "oro", "duc": "cian", "set": "morado"}
)

func tono(nombre, defecto string) color.NRGBA {
	if c, ok := tonos[nombre]; ok {
		return c
	}
	return tonos[defecto]
}

func conAlfa(c color.NRGBA, a uint8) color.NRGBA { c.A = a; return c }

// Medidas para un juego de `alto` píxeles: todo escala desde 1440p.
type estilo struct {
	s                                     float64
	titulo, chip, precio, lista, listaNeg font.Face
	pad, gap, radio, margen               int
}

var (
	muEstilo  sync.Mutex
	estilos   = map[int]*estilo{}
	fuenteNeg *opentype.Font
	fuenteMed *opentype.Font
)

func cara(f *opentype.Font, tam float64) font.Face {
	c, _ := opentype.NewFace(f, &opentype.FaceOptions{Size: tam, DPI: 72, Hinting: font.HintingFull})
	return c
}

func estiloPara(alto int) *estilo {
	muEstilo.Lock()
	defer muEstilo.Unlock()
	if e, ok := estilos[alto]; ok {
		return e
	}
	if fuenteNeg == nil {
		fuenteNeg, _ = opentype.Parse(gobold.TTF)
		fuenteMed, _ = opentype.Parse(gomedium.TTF)
	}
	s := float64(alto) / 1440
	e := &estilo{s: s,
		titulo: cara(fuenteNeg, 14*s), chip: cara(fuenteNeg, 12.5*s), precio: cara(fuenteNeg, 23*s),
		lista: cara(fuenteMed, 15*s), listaNeg: cara(fuenteNeg, 15*s),
	}
	e.pad, e.gap, e.radio, e.margen = e.px(13), e.px(7), e.px(14), e.px(10)
	estilos[alto] = e
	return e
}

func (e *estilo) px(v float64) int { return max(1, int(v*e.s+0.5)) }

func alto(f font.Face) int { m := f.Metrics(); return (m.Ascent + m.Descent).Ceil() }

func anchoTexto(f font.Face, s string) int { return font.MeasureString(f, s).Ceil() }

// Las mayúsculas pequeñas de la app van con algo de espacio entre letras.
func (e *estilo) anchoEspaciado(f font.Face, s string) int {
	return anchoTexto(f, s) + max(0, len([]rune(s))-1)*e.px(0.8)
}

func escribe(img *image.RGBA, f font.Face, c color.Color, x, base int, s string) int {
	d := &font.Drawer{Dst: img, Src: image.NewUniform(c), Face: f, Dot: fixed.P(x, base)}
	d.DrawString(s)
	return d.Dot.X.Ceil()
}

func (e *estilo) escribeEspaciado(img *image.RGBA, f font.Face, c color.Color, x, base int, s string) {
	for _, r := range s {
		x = escribe(img, f, c, x, base, string(r)) + e.px(0.8)
	}
}

// --- Medidas de cada bloque ---

func (e *estilo) anchoChip(c chip) int { return e.anchoEspaciado(e.chip, c.Texto) + 2*e.px(8) }
func (e *estilo) altoChip() int        { return alto(e.chip) + 2*e.px(3) }

func (e *estilo) anchoLista(b bloque) []int {
	var cols []int
	for _, fila := range b.Filas {
		for i, pt := range fila {
			f := e.lista
			if i > 0 {
				f = e.listaNeg
			}
			if i >= len(cols) {
				cols = append(cols, 0)
			}
			cols[i] = max(cols[i], anchoTexto(f, pt.Texto))
		}
	}
	return cols
}

func (e *estilo) anchoBloque(b bloque) int {
	switch b.Tipo {
	case "titulo":
		return e.anchoEspaciado(e.titulo, strings.ToUpper(b.Texto))
	case "chips":
		w := 0
		for i, c := range b.Chips {
			if i > 0 {
				w += e.px(5)
			}
			w += e.anchoChip(c)
		}
		return w
	case "estado":
		return e.anchoEspaciado(e.chip, strings.ToUpper(b.Texto)) + 2*e.px(7)
	case "precio":
		w := alto(e.precio) + e.px(4) + anchoTexto(e.precio, b.Plat)
		if b.Ducados != "" {
			w += e.px(16) + alto(e.precio) + e.px(4) + anchoTexto(e.precio, b.Ducados)
		}
		return w
	case "lista":
		w := 0
		for i, c := range e.anchoLista(b) {
			if i > 0 {
				w += e.px(11)
			}
			w += c
		}
		return w
	}
	return 0
}

// Filas de píldoras que caben en `w`.
func (e *estilo) filasChips(b bloque, w int) [][]chip {
	var filas [][]chip
	usado := 0
	for _, c := range b.Chips {
		cw := e.anchoChip(c)
		if len(filas) == 0 || usado+e.px(5)+cw > w {
			filas = append(filas, nil)
			usado = -e.px(5)
		}
		filas[len(filas)-1] = append(filas[len(filas)-1], c)
		usado += e.px(5) + cw
	}
	return filas
}

func (e *estilo) altoBloque(b bloque, w int) int {
	switch b.Tipo {
	case "titulo":
		return alto(e.titulo)
	case "chips":
		n := len(e.filasChips(b, w))
		return n*e.altoChip() + max(0, n-1)*e.px(4)
	case "estado":
		return alto(e.chip) + 2*e.px(3)
	case "separador":
		return 1
	case "precio":
		return alto(e.precio)
	case "lista":
		return len(b.Filas)*alto(e.lista) + max(0, len(b.Filas)-1)*e.px(3)
	}
	return 0
}

func (e *estilo) anchoPanel(p panel) int {
	w := 0
	for _, b := range p.Bloques {
		w = max(w, e.anchoBloque(b))
	}
	return w + 2*e.pad
}

// --- Dibujo ---

func (e *estilo) dibujaPanel(p panel, w int) *image.RGBA {
	interior := w - 2*e.pad
	h := 2 * e.pad
	for i, b := range p.Bloques {
		if i > 0 {
			h += e.gap
		}
		h += e.altoBloque(b, interior)
	}
	m := e.margen
	img := image.NewRGBA(image.Rect(0, 0, w+2*m, h+2*m))
	caja := image.Rect(m, m, m+w, m+h)

	// Sombra oscura o, si el panel destaca, resplandor de su color, como el box-shadow de la app.
	sombra := color.NRGBA{}
	if t, ok := tonoDeBorde[p.Borde]; ok {
		sombra = tonos[t]
	}
	for i := m; i > 0; i-- {
		c := conAlfa(sombra, uint8(34*(m-i+1)/m))
		draw.DrawMask(img, caja.Inset(-i), image.NewUniform(c), image.Point{}, redondeado(w+2*i, h+2*i, float32(e.radio+i)), image.Point{}, draw.Over)
	}
	grosor, borde := 1, bordeSuave
	if t, ok := tonoDeBorde[p.Borde]; ok {
		grosor, borde = e.px(2), tonos[t]
	}
	draw.DrawMask(img, caja, image.NewUniform(borde), image.Point{}, redondeado(w, h, float32(e.radio)), image.Point{}, draw.Over)
	draw.DrawMask(img, caja.Inset(grosor), image.NewUniform(fondoPanel), image.Point{}, redondeado(w-2*grosor, h-2*grosor, float32(e.radio-grosor)), image.Point{}, draw.Over)

	x0, y := m+e.pad, m+e.pad
	for i, b := range p.Bloques {
		if i > 0 {
			y += e.gap
		}
		e.dibujaBloque(img, b, x0, y, interior)
		y += e.altoBloque(b, interior)
	}
	return img
}

func (e *estilo) dibujaBloque(img *image.RGBA, b bloque, x0, y, w int) {
	switch b.Tipo {
	case "titulo":
		e.escribeEspaciado(img, e.titulo, tono(b.Tono, "ducado"), x0, y+e.titulo.Metrics().Ascent.Ceil(), strings.ToUpper(b.Texto))
	case "chips":
		for _, fila := range e.filasChips(b, w) {
			fw := -e.px(5)
			for _, c := range fila {
				fw += e.px(5) + e.anchoChip(c)
			}
			x := x0 + (w-fw)/2
			for _, c := range fila {
				e.dibujaChip(img, c, x, y)
				x += e.anchoChip(c) + e.px(5)
			}
			y += e.altoChip() + e.px(4)
		}
	case "estado":
		texto := strings.ToUpper(b.Texto)
		c := tono(b.Tono, "verde")
		bw, bh := e.anchoBloque(b), e.altoBloque(b, w)
		x := x0 + (w-bw)/2
		marco := image.Rect(x, y, x+bw, y+bh)
		draw.DrawMask(img, marco, image.NewUniform(c), image.Point{}, redondeado(bw, bh, float32(e.px(4))), image.Point{}, draw.Over)
		draw.DrawMask(img, marco.Inset(1), image.NewUniform(fondoPanel), image.Point{}, redondeado(bw-2, bh-2, float32(e.px(4)-1)), image.Point{}, draw.Over)
		e.escribeEspaciado(img, e.chip, c, x+e.px(7), y+e.px(3)+e.chip.Metrics().Ascent.Ceil(), texto)
	case "separador":
		draw.Draw(img, image.Rect(x0, y, x0+w, y+1), image.NewUniform(color.NRGBA{255, 255, 255, 26}), image.Point{}, draw.Over)
	case "precio":
		lado := alto(e.precio)
		x := x0 + (w-e.anchoBloque(b))/2
		base := y + e.precio.Metrics().Ascent.Ceil()
		e.dibujaIcono(img, "plat", x, y, lado)
		x = escribe(img, e.precio, tonos["oro"], x+lado+e.px(4), base, b.Plat)
		if b.Ducados != "" {
			x += e.px(16)
			e.dibujaIcono(img, "ducado", x, y, lado)
			escribe(img, e.precio, tonos["cian"], x+lado+e.px(4), base, b.Ducados)
		}
	case "lista":
		cols := e.anchoLista(b)
		resto := 0
		for i := 1; i < len(cols); i++ {
			resto += e.px(11) + cols[i]
		}
		nombreMax := max(0, w-resto)
		for _, fila := range b.Filas {
			base := y + e.lista.Metrics().Ascent.Ceil()
			x := x0
			for i, pt := range fila {
				if i == 0 {
					escribe(img, e.lista, tono(pt.Tono, "blanco"), x, base, recorta(e.lista, pt.Texto, nombreMax))
					x = x0 + nombreMax
					continue
				}
				x += e.px(11)
				escribe(img, e.listaNeg, tono(pt.Tono, "gris"), x+cols[i]-anchoTexto(e.listaNeg, pt.Texto), base, pt.Texto)
				x += cols[i]
			}
			y += alto(e.lista) + e.px(3)
		}
	}
}

func (e *estilo) dibujaChip(img *image.RGBA, c chip, x, y int) {
	cw, ch := e.anchoChip(c), e.altoChip()
	r := image.Rect(x, y, x+cw, y+ch)
	forma := redondeado(cw, ch, float32(ch)/2)
	var texto color.NRGBA
	switch c.Tipo {
	case "valor", "set":
		lleno := tonos["verde"]
		if c.Tipo == "set" {
			lleno = tonos["morado"]
		}
		draw.DrawMask(img, r, image.NewUniform(lleno), image.Point{}, forma, image.Point{}, draw.Over)
		texto = color.NRGBA{0, 0, 0, 255}
	default:
		base := map[string]string{"valor-justo": "verde", "set-cerca": "morado", "pl": "oro", "duc": "cian"}[c.Tipo]
		t := tono(base, "gris")
		draw.DrawMask(img, r, image.NewUniform(conAlfa(t, 115)), image.Point{}, forma, image.Point{}, draw.Over)
		draw.DrawMask(img, r.Inset(1), image.NewUniform(fondoPanel), image.Point{}, redondeado(cw-2, ch-2, float32(ch-2)/2), image.Point{}, draw.Over)
		draw.DrawMask(img, r.Inset(1), image.NewUniform(conAlfa(t, 28)), image.Point{}, redondeado(cw-2, ch-2, float32(ch-2)/2), image.Point{}, draw.Over)
		texto = t
	}
	e.escribeEspaciado(img, e.chip, texto, x+e.px(8), y+e.px(3)+e.chip.Metrics().Ascent.Ceil(), c.Texto)
}

func recorta(f font.Face, s string, w int) string {
	if anchoTexto(f, s) <= w {
		return s
	}
	r := []rune(s)
	for len(r) > 1 && anchoTexto(f, string(r)+"…") > w {
		r = r[:len(r)-1]
	}
	return string(r) + "…"
}

// --- Iconos de la app ---

var (
	muIconos = sync.Mutex{}
	iconos   = map[string]image.Image{}
	escalas  = map[string]*image.RGBA{}
	rutasIco = map[string]string{"plat": "assets/relic_contents/platinum.webp", "ducado": "assets/Ducats.webp"}
)

func (e *estilo) dibujaIcono(img *image.RGBA, nombre string, x, y, lado int) {
	muIconos.Lock()
	defer muIconos.Unlock()
	clave := nombre + "@" + strconv.Itoa(lado)
	ico, ok := escalas[clave]
	if !ok {
		orig, ok := iconos[nombre]
		if !ok {
			if datos, err := leeRecurso(rutasIco[nombre]); err == nil {
				orig, _ = webp.Decode(bytes.NewReader(datos))
			}
			iconos[nombre] = orig
		}
		if orig != nil {
			ico = image.NewRGBA(image.Rect(0, 0, lado, lado))
			xdraw.CatmullRom.Scale(ico, ico.Bounds(), orig, orig.Bounds(), xdraw.Over, nil)
		}
		escalas[clave] = ico
	}
	if ico != nil {
		draw.Draw(img, image.Rect(x, y, x+lado, y+lado), ico, image.Point{}, draw.Over)
	}
}

// Rectángulo con esquinas redondeadas y suavizadas, como máscara.
func redondeado(w, h int, r float32) *image.Alpha {
	m := image.NewAlpha(image.Rect(0, 0, max(w, 0), max(h, 0)))
	if w <= 0 || h <= 0 {
		return m
	}
	fw, fh := float32(w), float32(h)
	r = max(0, min(r, fw/2, fh/2))
	k := r * 0.4477 // control de la Bézier cúbica que aproxima un cuarto de círculo
	z := vector.NewRasterizer(w, h)
	z.MoveTo(r, 0)
	z.LineTo(fw-r, 0)
	z.CubeTo(fw-k, 0, fw, k, fw, r)
	z.LineTo(fw, fh-r)
	z.CubeTo(fw, fh-k, fw-k, fh, fw-r, fh)
	z.LineTo(r, fh)
	z.CubeTo(k, fh, 0, fh-k, 0, fh-r)
	z.LineTo(0, r)
	z.CubeTo(0, k, k, 0, r, 0)
	z.ClosePath()
	z.Draw(m, m.Bounds(), image.Opaque, image.Point{})
	return m
}

// BGRA premultiplicado, lo que esperan X11 (32 bits) y UpdateLayeredWindow. image.RGBA ya está
// premultiplicado: solo cambia el orden.
func bgraPremultiplicado(img *image.RGBA) []byte {
	out := make([]byte, len(img.Pix))
	for i := 0; i < len(out); i += 4 {
		out[i], out[i+1], out[i+2], out[i+3] = img.Pix[i+2], img.Pix[i+1], img.Pix[i], img.Pix[i+3]
	}
	return out
}
