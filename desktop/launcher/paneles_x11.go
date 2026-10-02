//go:build !windows

package main

import (
	"errors"
	"image"
	"os"
	"strings"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/shape"
	"github.com/jezek/xgb/xproto"
)

// Ventanas override-redirect de XWayland: KWin no las gestiona y las pinta por encima de todo, también
// del juego a pantalla completa. Warframe bajo Proton es un cliente X11, así que comparten coordenadas.
var (
	xc      *xgb.Conn
	xVisual xproto.Visualid
	xCmap   xproto.Colormap
	xGC     xproto.Gcontext
	xVivas  = map[string][]xproto.Window{}
)

func cierraX() {
	if xc != nil {
		xc.Close()
	}
	xc, xGC = nil, 0
	clear(xVivas)
}

func puedePintar() bool { return os.Getenv("DISPLAY") != "" }

func conexionX() (*xgb.Conn, error) {
	if xc != nil {
		return xc, nil
	}
	c, err := xgb.NewConn()
	if err != nil {
		return nil, err
	}
	if err := shape.Init(c); err != nil {
		c.Close()
		return nil, err
	}
	scr := xproto.Setup(c).DefaultScreen(c)
	for _, d := range scr.AllowedDepths {
		for _, v := range d.Visuals {
			if d.Depth == 32 && v.Class == xproto.VisualClassTrueColor && xVisual == 0 {
				xVisual = v.VisualId
			}
		}
	}
	if xVisual == 0 {
		c.Close()
		return nil, errors.New("X11 sin transparencia (visual de 32 bits)")
	}
	xCmap, _ = xproto.NewColormapId(c)
	xproto.CreateColormap(c, xproto.ColormapAllocNone, xCmap, scr.Root, xVisual)
	go func() {
		for {
			if ev, err := c.WaitForEvent(); ev == nil && err == nil {
				return
			}
		}
	}()
	xc = c
	return c, nil
}

func propiedad(c *xgb.Conn, w xproto.Window, nombre string) string {
	atomo, err := xproto.InternAtom(c, true, uint16(len(nombre)), nombre).Reply()
	if err != nil || atomo.Atom == 0 {
		return ""
	}
	r, err := xproto.GetProperty(c, false, w, atomo.Atom, xproto.GetPropertyTypeAny, 0, 256).Reply()
	if err != nil {
		return ""
	}
	return string(r.Value)
}

func ventanaDelJuego() (rectJuego, error) {
	c, err := conexionX()
	if err != nil {
		return rectJuego{}, err
	}
	root := xproto.Setup(c).DefaultScreen(c).Root
	arbol, err := xproto.QueryTree(c, root).Reply()
	if err != nil {
		cierraX()
		return rectJuego{}, err
	}
	for _, w := range arbol.Children {
		clase := propiedad(c, w, "WM_CLASS")
		if !strings.Contains(clase, "steam_app_230410") && propiedad(c, w, "WM_NAME") != "Warframe" {
			continue
		}
		if a, err := xproto.GetWindowAttributes(c, w).Reply(); err != nil || a.MapState != xproto.MapStateViewable {
			continue
		}
		g, err := xproto.GetGeometry(c, xproto.Drawable(w)).Reply()
		if err != nil {
			continue
		}
		p, err := xproto.TranslateCoordinates(c, w, root, 0, 0).Reply()
		if err != nil {
			continue
		}
		return rectJuego{int(p.DstX), int(p.DstY), int(g.Width), int(g.Height)}, nil
	}
	return rectJuego{}, errors.New("no se encuentra la ventana de Warframe")
}

func creaVentanaX(c *xgb.Conn, root xproto.Window, e panelPintado) (xproto.Window, error) {
	b := e.img.Bounds()
	win, err := xproto.NewWindowId(c)
	if err != nil {
		return 0, err
	}
	err = xproto.CreateWindowChecked(c, 32, win, root, int16(e.x), int16(e.y), uint16(b.Dx()), uint16(b.Dy()), 0,
		xproto.WindowClassInputOutput, xVisual,
		xproto.CwBackPixel|xproto.CwBorderPixel|xproto.CwOverrideRedirect|xproto.CwColormap,
		[]uint32{0, 0, 1, uint32(xCmap)}).Check()
	if err != nil {
		return 0, err
	}
	// Región de entrada vacía: el ratón pasa al juego.
	shape.Rectangles(c, shape.SoSet, shape.SkInput, xproto.ClipOrderingUnsorted, win, 0, 0, nil)
	xproto.MapWindow(c, win)
	return win, nil
}

func pintaVentanaX(c *xgb.Conn, win xproto.Window, img *image.RGBA) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if xGC == 0 {
		xGC, _ = xproto.NewGcontextId(c)
		xproto.CreateGC(c, xGC, xproto.Drawable(win), 0, nil)
	}
	datos := bgraPremultiplicado(img)
	// Sin BIG-REQUESTS una petición no pasa de 256 KB: la imagen va por franjas.
	filas := max(1, 60000/(w*4))
	for y0 := 0; y0 < h; y0 += filas {
		y1 := min(h, y0+filas)
		xproto.PutImage(c, xproto.ImageFormatZPixmap, xproto.Drawable(win), xGC, uint16(w), uint16(y1-y0), 0, int16(y0), 0, 32, datos[y0*w*4:y1*w*4])
	}
}

func muestraGrupo(grupo string, lista []panelPintado) error {
	c, err := conexionX()
	if err != nil {
		return err
	}
	root := xproto.Setup(c).DefaultScreen(c).Root
	previas := xVivas[grupo]
	var vivas []xproto.Window
	for i, e := range lista {
		var win xproto.Window
		if i < len(previas) {
			win = previas[i]
			b := e.img.Bounds()
			xproto.ConfigureWindow(c, win, xproto.ConfigWindowX|xproto.ConfigWindowY|xproto.ConfigWindowWidth|xproto.ConfigWindowHeight,
				[]uint32{uint32(int32(e.x)), uint32(int32(e.y)), uint32(b.Dx()), uint32(b.Dy())})
		} else if win, err = creaVentanaX(c, root, e); err != nil {
			cierraX()
			return err
		}
		vivas = append(vivas, win)
		pintaVentanaX(c, win, e.img)
	}
	for _, win := range previas[min(len(lista), len(previas)):] {
		xproto.DestroyWindow(c, win)
	}
	xVivas[grupo] = vivas
	if _, err = xproto.GetInputFocus(c).Reply(); err != nil {
		cierraX()
	}
	return err
}

func grupoVisible(grupo string) bool { return len(xVivas[grupo]) > 0 }

func gruposVisibles() []string {
	var gs []string
	for g := range xVivas {
		gs = append(gs, g)
	}
	return gs
}

func quitaGrupo(grupo string) {
	ventanas := xVivas[grupo]
	delete(xVivas, grupo)
	if xc == nil || len(ventanas) == 0 {
		return
	}
	for _, w := range ventanas {
		xproto.DestroyWindow(xc, w)
	}
	xproto.GetInputFocus(xc).Reply()
}
