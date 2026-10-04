package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	warframeAppID = "230410"
	maxCola       = 1 << 20
	maxPorTick    = 1 << 20
)

func rutaEELog() string {
	if p := os.Getenv("VOIDSTONKS_EELOG"); p != "" {
		return p
	}
	var cands []string
	if runtime.GOOS == "windows" {
		cands = []string{filepath.Join(os.Getenv("LocalAppData"), "Warframe", "EE.log")}
	} else {
		dentro := filepath.Join("steamapps", "compatdata", warframeAppID, "pfx", "drive_c", "users",
			"steamuser", "AppData", "Local", "Warframe", "EE.log")
		for _, lib := range bibliotecasSteam() {
			cands = append(cands, filepath.Join(lib, dentro))
		}
	}
	mejor, cuando := "", time.Time{}
	for _, c := range cands {
		if info, err := os.Stat(c); err == nil && info.ModTime().After(cuando) {
			mejor, cuando = c, info.ModTime()
		}
	}
	return mejor
}

var rePathVDF = regexp.MustCompile(`"path"\s+"([^"]+)"`)

func bibliotecasSteam() []string {
	home, _ := os.UserHomeDir()
	raices := []string{
		filepath.Join(home, ".local", "share", "Steam"),
		filepath.Join(home, ".steam", "steam"),
		filepath.Join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
	}
	vistas := map[string]bool{}
	var libs []string
	anade := func(p string) {
		if real, err := filepath.EvalSymlinks(p); err == nil && !vistas[real] {
			vistas[real] = true
			libs = append(libs, real)
		}
	}
	for _, raiz := range raices {
		anade(raiz)
		vdf, err := os.ReadFile(filepath.Join(raiz, "steamapps", "libraryfolders.vdf"))
		if err != nil {
			continue
		}
		for _, m := range rePathVDF.FindAllSubmatch(vdf, -1) {
			anade(strings.ReplaceAll(string(m[1]), `\\`, `\`))
		}
	}
	return libs
}

type seguidor struct {
	pos   int64
	resto []byte
	tirar bool
}

func servirEELog(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "sin streaming", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	cola, _ := strconv.ParseInt(r.URL.Query().Get("cola"), 10, 64)
	cola = min(max(cola, 0), maxCola)

	ruta := rutaEELog()
	evento(w, "ruta", ruta)
	fl.Flush()

	s := seguidor{pos: -1}
	falta := false
	ultimo := time.Now()
	tic := time.NewTicker(500 * time.Millisecond)
	defer tic.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-tic.C:
		}
		if !concedido("eelog") {
			return
		}
		if ruta == "" {
			ruta = rutaEELog()
		}
		escrito := false
		info, err := os.Stat(ruta)
		switch {
		case ruta == "" || err != nil:
			if !falta {
				evento(w, "falta", ruta)
				falta, escrito = true, true
			}
			s = seguidor{}
		case s.pos < 0:
			s.pos = max(info.Size()-cola, 0)
			s.tirar = s.pos > 0
		case info.Size() < s.pos:
			evento(w, "reinicio", ruta)
			escrito = true
			s = seguidor{}
		}
		if err == nil && ruta != "" {
			falta = false
			if lineas := s.leer(ruta, info.Size()); len(lineas) > 0 {
				evento(w, "lineas", strings.Join(lineas, "\n"))
				escrito = true
			}
		}
		if !escrito && time.Since(ultimo) > 15*time.Second {
			io.WriteString(w, ": latido\n\n")
			escrito = true
		}
		if escrito {
			fl.Flush()
			ultimo = time.Now()
		}
	}
}

func (s *seguidor) leer(ruta string, hasta int64) []string {
	if hasta <= s.pos {
		return nil
	}
	f, err := os.Open(ruta)
	if err != nil {
		return nil
	}
	defer f.Close()
	buf := make([]byte, min(hasta-s.pos, maxPorTick))
	n, _ := f.ReadAt(buf, s.pos)
	s.pos += int64(n)
	datos := append(s.resto, buf[:n]...)
	corte := bytes.LastIndexByte(datos, '\n')
	if corte < 0 {
		s.resto = datos
		return nil
	}
	s.resto = append([]byte(nil), datos[corte+1:]...)
	lineas := strings.Split(string(datos[:corte]), "\n")
	if s.tirar {
		lineas, s.tirar = lineas[1:], false
	}
	for i, l := range lineas {
		lineas[i] = strings.TrimRight(l, "\r")
	}
	return lineas
}

func evento(w io.Writer, nombre, datos string) {
	fmt.Fprintf(w, "event: %s\n", nombre)
	for _, l := range strings.Split(datos, "\n") {
		fmt.Fprintf(w, "data: %s\n", l)
	}
	io.WriteString(w, "\n")
}
