//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func avisar(titulo, msg string) {
	fmt.Fprintln(os.Stderr, titulo+": "+msg)
	if ns, err := exec.LookPath("notify-send"); err == nil {
		exec.Command(ns, "-u", "critical", titulo, msg).Run()
	}
}
