package main

import (
	"syscall"
	"unsafe"
)

// Compilado con -H=windowsgui no hay consola: el error tiene que salir en una ventana.
func avisar(titulo, msg string) {
	t, _ := syscall.UTF16PtrFromString(titulo)
	m, _ := syscall.UTF16PtrFromString(msg)
	const mbIconError = 0x10
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0,
		uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconError)
}
