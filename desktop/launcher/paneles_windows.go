package main

import (
	"errors"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

var (
	gdi32                     = syscall.NewLazyDLL("gdi32.dll")
	enumWindows               = user32.NewProc("EnumWindows")
	getWindowTextW            = user32.NewProc("GetWindowTextW")
	isWindowVisible           = user32.NewProc("IsWindowVisible")
	getWindowRect             = user32.NewProc("GetWindowRect")
	setProcessDPIAware        = user32.NewProc("SetProcessDPIAware")
	registerClassExW          = user32.NewProc("RegisterClassExW")
	createWindowExW           = user32.NewProc("CreateWindowExW")
	destroyWindow             = user32.NewProc("DestroyWindow")
	defWindowProcW            = user32.NewProc("DefWindowProcW")
	showWindow                = user32.NewProc("ShowWindow")
	updateLayeredWindow       = user32.NewProc("UpdateLayeredWindow")
	getDC                     = user32.NewProc("GetDC")
	releaseDC                 = user32.NewProc("ReleaseDC")
	peekMessageW              = user32.NewProc("PeekMessageW")
	translateMessage          = user32.NewProc("TranslateMessage")
	dispatchMessageW          = user32.NewProc("DispatchMessageW")
	msgWaitForMultipleObjects = user32.NewProc("MsgWaitForMultipleObjects")
	getModuleHandleW          = kernel32.NewProc("GetModuleHandleW")
	createCompatibleDC        = gdi32.NewProc("CreateCompatibleDC")
	createDIBSection          = gdi32.NewProc("CreateDIBSection")
	selectObject              = gdi32.NewProc("SelectObject")
	deleteObject              = gdi32.NewProc("DeleteObject")
	deleteDC                  = gdi32.NewProc("DeleteDC")
)

var (
	muBusca      sync.Mutex
	buscaTitulo  string
	buscaHallada uintptr
	cbBusca      = syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		if v, _, _ := isWindowVisible.Call(hwnd); v == 0 {
			return 1
		}
		var buf [512]uint16
		n, _, _ := getWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		if n > 0 && syscall.UTF16ToString(buf[:n]) == buscaTitulo {
			buscaHallada = hwnd
			return 0
		}
		return 1
	})
)

func puedePintar() bool { return true }

func buscarVentana(titulo string) uintptr {
	muBusca.Lock()
	defer muBusca.Unlock()
	buscaTitulo, buscaHallada = titulo, 0
	enumWindows.Call(cbBusca, 0)
	return buscaHallada
}

type rect struct{ izq, arr, der, aba int32 }

func ventanaDelJuego() (rectJuego, error) {
	arrancaGUI.Do(func() { go hiloGUI() })
	<-guiLista
	hwnd := buscarVentana("Warframe")
	if hwnd == 0 {
		return rectJuego{}, errors.New("no se encuentra la ventana de Warframe")
	}
	var r rect
	getWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	return rectJuego{int(r.izq), int(r.arr), int(r.der - r.izq), int(r.aba - r.arr)}, nil
}

var (
	arrancaGUI sync.Once
	guiLista   = make(chan struct{})
	ordenes    = make(chan func())
	vivas      = map[string][]uintptr{}
	claseOK    uintptr
)

type wndClassExW struct {
	cbSize, style                            uint32
	lpfnWndProc                              uintptr
	cbClsExtra, cbWndExtra                   int32
	hInstance, hIcon, hCursor, hbrBackground uintptr
	lpszMenuName, lpszClassName              *uint16
	hIconSm                                  uintptr
}

type msgW struct {
	hwnd           uintptr
	message        uint32
	wParam, lParam uintptr
	time           uint32
	x, y           int32
	lPrivate       uint32
}

func hiloGUI() {
	runtime.LockOSThread()
	setProcessDPIAware.Call()
	inst, _, _ := getModuleHandleW.Call(0)
	nombre, _ := syscall.UTF16PtrFromString("VoidStonksPanel")
	wc := wndClassExW{lpfnWndProc: defWindowProcW.Addr(), hInstance: inst, lpszClassName: nombre}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	claseOK, _, _ = registerClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	close(guiLista)
	const qsAllInput, pmRemove = 0x04FF, 0x0001
	var m msgW
	for {
		select {
		case f := <-ordenes:
			f()
			continue
		default:
		}
		msgWaitForMultipleObjects.Call(0, 0, 0, 50, qsAllInput)
		for {
			if r, _, _ := peekMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, pmRemove); r == 0 {
				break
			}
			translateMessage.Call(uintptr(unsafe.Pointer(&m)))
			dispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
	}
}

func enHiloGUI(f func() error) error {
	arrancaGUI.Do(func() { go hiloGUI() })
	<-guiLista
	hecho := make(chan error, 1)
	ordenes <- func() { hecho <- f() }
	return <-hecho
}

func muestraGrupo(grupo string, lista []panelPintado) error {
	return enHiloGUI(func() error {
		if claseOK == 0 {
			return errors.New("RegisterClassEx")
		}
		previas := vivas[grupo]
		var nuevas []uintptr
		for i, e := range lista {
			var hwnd uintptr
			if i < len(previas) {
				hwnd = previas[i]
			} else if hwnd = creaVentana(); hwnd == 0 {
				vivas[grupo] = append(nuevas, previas[min(i, len(previas)):]...)
				return errors.New("CreateWindowEx")
			}
			nuevas = append(nuevas, hwnd)
			if err := pintaVentana(hwnd, e); err != nil {
				vivas[grupo] = append(nuevas, previas[min(i+1, len(previas)):]...)
				return err
			}
		}
		for _, h := range previas[min(len(lista), len(previas)):] {
			destroyWindow.Call(h)
		}
		vivas[grupo] = nuevas
		return nil
	})
}

func creaVentana() uintptr {
	const (
		wsExLayered, wsExTransparent, wsExTopmost = 0x80000, 0x20, 0x8
		wsExToolWindow, wsExNoActivate            = 0x80, 0x08000000
		wsPopup                                   = 0x80000000
	)
	nombre, _ := syscall.UTF16PtrFromString("VoidStonksPanel")
	inst, _, _ := getModuleHandleW.Call(0)
	hwnd, _, _ := createWindowExW.Call(wsExLayered|wsExTransparent|wsExTopmost|wsExToolWindow|wsExNoActivate,
		uintptr(unsafe.Pointer(nombre)), 0, wsPopup, 0, 0, 1, 1, 0, 0, inst, 0)
	return hwnd
}

func pintaVentana(hwnd uintptr, e panelPintado) error {
	const swShowNoActivate = 4
	b := e.img.Bounds()
	w, h := b.Dx(), b.Dy()
	pantalla, _, _ := getDC.Call(0)
	defer releaseDC.Call(0, pantalla)
	memoria, _, _ := createCompatibleDC.Call(pantalla)
	defer deleteDC.Call(memoria)
	type bitmapInfoHeader struct {
		biSize                           uint32
		biWidth, biHeight                int32
		biPlanes, biBitCount             uint16
		biCompression, biSizeImage       uint32
		biXPelsPerMeter, biYPelsPerMeter int32
		biClrUsed, biClrImportant        uint32
	}
	bi := bitmapInfoHeader{biWidth: int32(w), biHeight: -int32(h), biPlanes: 1, biBitCount: 32}
	bi.biSize = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	dib, _, _ := createDIBSection.Call(memoria, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if dib == 0 || bits == nil {
		return errors.New("CreateDIBSection")
	}
	defer deleteObject.Call(dib)
	anterior, _, _ := selectObject.Call(memoria, dib)
	defer selectObject.Call(memoria, anterior)
	copy(unsafe.Slice((*byte)(bits), w*h*4), bgraPremultiplicado(e.img))

	type punto struct{ x, y int32 }
	destino, tam, origen := punto{int32(e.x), int32(e.y)}, punto{int32(w), int32(h)}, punto{}
	const acSrcOver, acSrcAlpha, ulwAlpha = 0, 1, 2
	mezcla := [4]byte{acSrcOver, 0, 255, acSrcAlpha}
	r, _, _ := updateLayeredWindow.Call(hwnd, pantalla, uintptr(unsafe.Pointer(&destino)), uintptr(unsafe.Pointer(&tam)),
		memoria, uintptr(unsafe.Pointer(&origen)), 0, uintptr(unsafe.Pointer(&mezcla)), ulwAlpha)
	if r == 0 {
		return errors.New("UpdateLayeredWindow")
	}
	showWindow.Call(hwnd, swShowNoActivate)
	return nil
}

func grupoVisible(grupo string) bool {
	visible := false
	enHiloGUI(func() error { visible = len(vivas[grupo]) > 0; return nil })
	return visible
}

func gruposVisibles() []string {
	var gs []string
	enHiloGUI(func() error {
		for g := range vivas {
			gs = append(gs, g)
		}
		return nil
	})
	return gs
}

func quitaEnHilo(grupo string) {
	for _, h := range vivas[grupo] {
		destroyWindow.Call(h)
	}
	delete(vivas, grupo)
}

func quitaGrupo(grupo string) {
	enHiloGUI(func() error { quitaEnHilo(grupo); return nil })
}
