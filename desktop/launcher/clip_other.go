//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"strings"
)

func comandoCopia() []string {
	cands := [][]string{{"xclip", "-selection", "clipboard"}, {"xsel", "--clipboard", "--input"}}
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		cands = append([][]string{{"wl-copy"}}, cands...)
	}
	for _, c := range cands {
		if _, err := exec.LookPath(c[0]); err == nil {
			return c
		}
	}
	return nil
}

func puedeCopiar() bool { return comandoCopia() != nil }

func copiar(texto string) error {
	c := comandoCopia()
	if c == nil {
		return errors.New("falta wl-copy, xclip o xsel")
	}
	cmd := exec.Command(c[0], c[1:]...)
	cmd.Stdin = strings.NewReader(texto)
	return cmd.Run()
}
