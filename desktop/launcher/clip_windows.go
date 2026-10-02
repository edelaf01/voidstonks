package main

import (
	"errors"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	openClipboard    = user32.NewProc("OpenClipboard")
	closeClipboard   = user32.NewProc("CloseClipboard")
	emptyClipboard   = user32.NewProc("EmptyClipboard")
	setClipboardData = user32.NewProc("SetClipboardData")
	globalAlloc      = kernel32.NewProc("GlobalAlloc")
	globalFree       = kernel32.NewProc("GlobalFree")
	globalLock       = kernel32.NewProc("GlobalLock")
	globalUnlock     = kernel32.NewProc("GlobalUnlock")
	rtlMoveMemory    = kernel32.NewProc("RtlMoveMemory")
)

func puedeCopiar() bool { return true }

func copiar(texto string) error {
	u, err := syscall.UTF16FromString(texto)
	if err != nil {
		return err
	}
	// El portapapeles es por hilo: abrir, escribir y cerrar en el mismo.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	// Falla si otro programa lo tiene abierto en ese instante.
	abierto := false
	for i := 0; i < 10 && !abierto; i++ {
		r, _, _ := openClipboard.Call(0)
		if abierto = r != 0; !abierto {
			time.Sleep(20 * time.Millisecond)
		}
	}
	if !abierto {
		return errors.New("portapapeles ocupado")
	}
	defer closeClipboard.Call()
	emptyClipboard.Call()

	const gmemMoveable, cfUnicodeText = 0x0002, 13
	tam := uintptr(len(u) * 2)
	h, _, _ := globalAlloc.Call(gmemMoveable, tam)
	if h == 0 {
		return errors.New("GlobalAlloc")
	}
	p, _, _ := globalLock.Call(h)
	if p == 0 {
		globalFree.Call(h)
		return errors.New("GlobalLock")
	}
	rtlMoveMemory.Call(p, uintptr(unsafe.Pointer(&u[0])), tam)
	globalUnlock.Call(h)
	if r, _, _ := setClipboardData.Call(cfUnicodeText, h); r == 0 {
		globalFree.Call(h)
		return errors.New("SetClipboardData")
	}
	return nil
}
