// VoidStonks de escritorio: sirve la app embebida en http://voidstonks.localhost:PUERTO y la
// abre en el Chromium instalado en modo app, con un perfil propio.
package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed app.zip
var appZip []byte

const (
	host = "voidstonks.localhost"
	// Puerto fijo: localStorage va por origen, y con otro puerto el inventario saldría vacío.
	firstPort = 47823
	lastPort  = 47830
	marca     = "voidstonks-launcher"
	// Una ventana minimizada solo dispara temporizadores una vez por minuto.
	sinLatido        = 90 * time.Second
	sinLatidoPaneles = 75 * time.Second
)

var ultimoLatido atomic.Int64

func main() {
	zr, err := zip.NewReader(bytes.NewReader(appZip), int64(len(appZip)))
	if err != nil {
		fatal("La app embebida está dañada: " + err.Error())
	}
	files := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		if !f.FileInfo().IsDir() {
			files[f.Name] = f
		}
	}
	archivosApp = files
	for ext, tipo := range map[string]string{
		".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
		".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
		".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
		".webp": "image/webp", ".png": "image/png", ".ico": "image/x-icon",
	} {
		// En Windows el registro puede decir text/plain para .js y los módulos no cargarían.
		mime.AddExtensionType(ext, tipo)
	}

	port, listeners := escuchar()
	if listeners != nil {
		ultimoLatido.Store(time.Now().UnixNano())
		srv := &http.Server{Handler: handler(files, port), ReadHeaderTimeout: 10 * time.Second}
		for _, l := range listeners {
			go srv.Serve(l)
		}
	}

	b, err := buscarNavegador()
	if err != nil {
		fatal(err.Error())
	}
	if err := b.abrir(fmt.Sprintf("http://%s:%d/", host, port)); err != nil {
		fatal("No se pudo abrir el navegador: " + err.Error())
	}
	if listeners == nil {
		return
	}
	// El proceso del navegador puede acabar sin cerrar la ventana (se la pasa a otra instancia
	// con el mismo perfil): se sigue sirviendo mientras la página dé señales de vida.
	for time.Since(time.Unix(0, ultimoLatido.Load())) < sinLatido {
		time.Sleep(5 * time.Second)
		if time.Since(time.Unix(0, ultimoLatido.Load())) > sinLatidoPaneles {
			quitaTodos()
		}
	}
	quitaTodos()
}

// Devuelve el puerto y sus listeners, o listeners nil si ya sirve otra instancia del lanzador.
func escuchar() (int, []net.Listener) {
	for p := firstPort; p <= lastPort; p++ {
		l4, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(p))
		if err != nil {
			if esNuestro(p) {
				return p, nil
			}
			continue
		}
		ls := []net.Listener{l4}
		// voidstonks.localhost puede resolver primero a ::1.
		if l6, err := net.Listen("tcp6", "[::1]:"+strconv.Itoa(p)); err == nil {
			ls = append(ls, l6)
		}
		return p, ls
	}
	fatal(fmt.Sprintf("Los puertos %d-%d están ocupados.", firstPort, lastPort))
	return 0, nil
}

func esNuestro(p int) bool {
	c := http.Client{Timeout: 2 * time.Second}
	req, _ := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d/__voidstonks", p), nil)
	req.Host = fmt.Sprintf("%s:%d", host, p)
	res, err := c.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	cuerpo, _ := io.ReadAll(io.LimitReader(res.Body, 64))
	return string(cuerpo) == marca
}

func handler(files map[string]*zip.File, port int) http.Handler {
	hostValido := fmt.Sprintf("%s:%d", host, port)
	// Para desarrollar: VOIDSTONKS_DIR=deploy sirve esa carpeta en vez de la app embebida y basta con recargar.
	var desdeCarpeta http.Handler
	if dir := os.Getenv("VOIDSTONKS_DIR"); dir != "" {
		desdeCarpeta = http.FileServer(http.Dir(dir))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Solo por voidstonks.localhost: desde 127.0.0.1 la app se tomaría por el entorno de
		// desarrollo y enseñaría el login de WFM. De paso corta el DNS rebinding.
		if r.Host != hostValido {
			http.Error(w, "host no permitido", http.StatusMisdirectedRequest)
			return
		}
		switch r.URL.Path {
		case "/__voidstonks":
			io.WriteString(w, marca)
			return
		case "/__voidstonks/alive":
			ultimoLatido.Store(time.Now().UnixNano())
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if nativo(w, r) {
			return
		}
		if desdeCarpeta != nil {
			w.Header().Set("Cache-Control", "no-cache")
			desdeCarpeta.ServeHTTP(w, r)
			return
		}
		f := buscar(files, r.URL.Path)
		if f == nil {
			http.NotFound(w, r)
			return
		}
		etag := `"` + strconv.FormatUint(uint64(f.CRC32), 16) + `"`
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "no-cache")
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		rc, err := f.Open()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		datos, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, f.Name, f.Modified, bytes.NewReader(datos))
	})
}

func buscar(files map[string]*zip.File, ruta string) *zip.File {
	p := strings.TrimPrefix(path.Clean("/"+ruta), "/")
	if p == "" {
		p = "index.html"
	}
	for _, c := range []string{p, p + "/index.html", p + ".html"} {
		if f, ok := files[c]; ok {
			return f
		}
	}
	return nil
}

var archivosApp map[string]*zip.File

// Un fichero de la app (los iconos del overlay): de la carpeta en modo desarrollo, si no del zip embebido.
func leeRecurso(ruta string) ([]byte, error) {
	if dir := os.Getenv("VOIDSTONKS_DIR"); dir != "" {
		return os.ReadFile(filepath.Join(dir, filepath.FromSlash(ruta)))
	}
	f := archivosApp[ruta]
	if f == nil {
		return nil, os.ErrNotExist
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func fatal(msg string) {
	avisar("VoidStonks", msg)
	os.Exit(1)
}
