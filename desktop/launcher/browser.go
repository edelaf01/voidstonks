package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type navegador struct {
	exe     string
	prefijo []string // "run <id>" para los flatpak
	perfil  string
}

// VOIDSTONKS_BROWSER permite forzar un ejecutable concreto.
func buscarNavegador() (*navegador, error) {
	if exe := os.Getenv("VOIDSTONKS_BROWSER"); exe != "" {
		return &navegador{exe: exe, perfil: perfilPropio()}, nil
	}
	if runtime.GOOS == "windows" {
		return buscarWindows()
	}
	return buscarLinux()
}

func buscarWindows() (*navegador, error) {
	var rutas []string
	for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")} {
		if base == "" {
			continue
		}
		rutas = append(rutas,
			filepath.Join(base, `Google\Chrome\Application\chrome.exe`),
			filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(base, `BraveSoftware\Brave-Browser\Application\brave.exe`),
		)
	}
	for _, r := range rutas {
		if _, err := os.Stat(r); err == nil {
			return &navegador{exe: r, perfil: perfilPropio()}, nil
		}
	}
	return nil, errors.New("No se encontró Chrome, Edge ni Brave. Instala uno de ellos y vuelve a abrir VoidStonks.")
}

func buscarLinux() (*navegador, error) {
	for _, n := range []string{"google-chrome-stable", "google-chrome", "chromium", "chromium-browser",
		"brave-browser", "brave", "microsoft-edge-stable", "microsoft-edge"} {
		if exe, err := exec.LookPath(n); err == nil {
			return &navegador{exe: exe, perfil: perfilPropio()}, nil
		}
	}
	if flatpak, err := exec.LookPath("flatpak"); err == nil {
		for _, id := range []string{"com.google.Chrome", "org.chromium.Chromium", "com.brave.Browser",
			"com.microsoft.Edge", "io.github.ungoogled_software.ungoogled_chromium"} {
			if exec.Command(flatpak, "info", id).Run() == nil {
				// El sandbox siempre puede escribir en su ~/.var/app/<id>.
				home, _ := os.UserHomeDir()
				perfil := filepath.Join(home, ".var", "app", id, "data", "voidstonks-browser")
				return &navegador{exe: flatpak, prefijo: []string{"run", id}, perfil: perfil}, nil
			}
		}
	}
	return nil, errors.New("No se encontró Chrome, Chromium, Brave ni Edge. Instala uno de ellos y vuelve a abrir VoidStonks.")
}

// Fuera de la caché: ahí vive el perfil del navegador, con el localStorage, es decir, el inventario.
func dirDatos() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("LocalAppData"), "VoidStonks")
	}
	datos := os.Getenv("XDG_DATA_HOME")
	if datos == "" {
		home, _ := os.UserHomeDir()
		datos = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(datos, "voidstonks")
}

func perfilPropio() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(dirDatos(), "Browser")
	}
	return filepath.Join(dirDatos(), "browser")
}

// Bloquea hasta que el navegador termina.
func (n *navegador) abrir(url string) error {
	_, err := os.Stat(n.perfil)
	primeraVez := os.IsNotExist(err)
	if err := os.MkdirAll(n.perfil, 0o700); err != nil {
		return err
	}
	args := append([]string{}, n.prefijo...)
	args = append(args, "--app="+url, "--user-data-dir="+n.perfil,
		"--no-first-run", "--no-default-browser-check", "--disable-features=Translate")
	if runtime.GOOS == "linux" {
		args = append(args, "--class=VoidStonks")
	}
	// Solo la primera vez: después Chrome recuerda el tamaño que dejó el usuario.
	if primeraVez {
		args = append(args, "--window-size=1440,900")
	}
	return exec.Command(n.exe, args...).Run()
}
