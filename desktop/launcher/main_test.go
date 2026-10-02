package main

import (
	"archive/zip"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func peticion(metodo, ruta, sitio, cabecera string) *http.Request {
	r := httptest.NewRequest(metodo, ruta, nil)
	r.Host = "voidstonks.localhost:47823"
	if sitio != "" {
		r.Header.Set("Sec-Fetch-Site", sitio)
	}
	if cabecera != "" {
		r.Header.Set("X-VoidStonks", cabecera)
	}
	return r
}

func TestSoloLaApp(t *testing.T) {
	casos := []struct {
		r    *http.Request
		pasa bool
	}{
		{peticion("GET", "/__voidstonks/caps", "same-origin", ""), true},
		{peticion("GET", "/__voidstonks/caps", "cross-site", ""), false},
		{peticion("GET", "/__voidstonks/caps", "", ""), false},
		{peticion("POST", "/__voidstonks/clip", "same-origin", ""), false},
		{peticion("POST", "/__voidstonks/clip", "same-origin", "1"), true},
		{peticion("POST", "/__voidstonks/clip", "same-site", "1"), false},
	}
	for i, c := range casos {
		if got := soloLaApp(c.r); got != c.pasa {
			t.Errorf("caso %d: soloLaApp = %v, quería %v", i, got, c.pasa)
		}
	}
}

func TestRutaNativaDesdeOtraWebDa403(t *testing.T) {
	w := httptest.NewRecorder()
	if !nativo(w, peticion("POST", "/__voidstonks/clip", "cross-site", "")) || w.Code != http.StatusForbidden {
		t.Fatalf("código %d", w.Code)
	}
	if nativo(httptest.NewRecorder(), peticion("GET", "/index.html", "same-origin", "")) {
		t.Fatal("una ruta normal no es nativa")
	}
}

func TestHostDistintoSeRechaza(t *testing.T) {
	h := handler(map[string]*zip.File{}, 47823)
	r := httptest.NewRequest("GET", "/", nil)
	r.Host = "127.0.0.1:47823"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusMisdirectedRequest {
		t.Fatalf("127.0.0.1 debe rechazarse (enseñaría el login de WFM): %d", w.Code)
	}
}

func TestBuscarRutas(t *testing.T) {
	files := map[string]*zip.File{"index.html": {}, "guide.html": {}, "js/main.js": {}}
	for ruta, quiere := range map[string]bool{
		"/": true, "/guide": true, "/js/main.js": true, "/../index.html": true, "/nada.js": false,
	} {
		if got := buscar(files, ruta) != nil; got != quiere {
			t.Errorf("%s: %v", ruta, got)
		}
	}
}

func TestSeguidorEELog(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "EE.log")
	escribe := func(s string, anexa bool) {
		flag := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
		if anexa {
			flag = os.O_CREATE | os.O_WRONLY | os.O_APPEND
		}
		f, _ := os.OpenFile(ruta, flag, 0o644)
		f.WriteString(s)
		f.Close()
	}
	tam := func() int64 { i, _ := os.Stat(ruta); return i.Size() }

	escribe("vieja 1\nvieja 2\nvieja 3\n", false)
	// Saltar a la cola en mitad de una línea: esa primera llega cortada y se tira.
	s := seguidor{pos: tam() - 10, tirar: true}
	if got := s.leer(ruta, tam()); !reflect.DeepEqual(got, []string{"vieja 3"}) {
		t.Fatalf("cola: %q", got)
	}
	escribe("nueva\r\nsin acab", true)
	if got := s.leer(ruta, tam()); !reflect.DeepEqual(got, []string{"nueva"}) {
		t.Fatalf("CRLF y línea a medias: %q", got)
	}
	escribe("ar\n", true)
	if got := s.leer(ruta, tam()); !reflect.DeepEqual(got, []string{"sin acabar"}) {
		t.Fatalf("la línea a medias se completa: %q", got)
	}
	if got := s.leer(ruta, tam()); got != nil {
		t.Fatalf("sin novedades no hay líneas: %q", got)
	}
}

func TestBibliotecasDesdeVDF(t *testing.T) {
	vdf := `"libraryfolders" { "0" { "path"		"/var/home/x/.local/share/Steam" } "1" { "path" "/mnt/games3/Steamjuegos" } }`
	var rutas []string
	for _, m := range rePathVDF.FindAllStringSubmatch(vdf, -1) {
		rutas = append(rutas, m[1])
	}
	if !reflect.DeepEqual(rutas, []string{"/var/home/x/.local/share/Steam", "/mnt/games3/Steamjuegos"}) {
		t.Fatalf("%q", rutas)
	}
}

func conPermisos(t *testing.T) {
	t.Helper()
	viejaRuta, viejos := rutaPermisos, cargados
	rutaPermisos, cargados = filepath.Join(t.TempDir(), "permisos.json"), nil
	t.Cleanup(func() { rutaPermisos, cargados = viejaRuta, viejos })
}

func TestSinPermisoLaRutaNativaDa403(t *testing.T) {
	conPermisos(t)
	w := httptest.NewRecorder()
	nativo(w, peticion("POST", "/__voidstonks/clip", "same-origin", "1"))
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "permiso") {
		t.Fatalf("código %d: %s", w.Code, w.Body.String())
	}
}

func TestPermisosSeGuardanYSoloSePreguntaLoNuevo(t *testing.T) {
	conPermisos(t)
	if _, pend := estadoPermisos(); !reflect.DeepEqual(pend, permisosConocidos) {
		t.Fatalf("la primera vez se pregunta todo: %v", pend)
	}
	if err := guardarPermisos(map[string]bool{"eelog": true, "clip": false, "inventado": true}); err != nil {
		t.Fatal(err)
	}
	concedidos, pend := estadoPermisos()
	if !concedidos["eelog"] || concedidos["clip"] || !reflect.DeepEqual(pend, []string{"overlay"}) {
		t.Fatalf("concedidos %v, pendientes %v", concedidos, pend)
	}
	// Lo guardado sobrevive a reiniciar el lanzador.
	cargados = nil
	if !concedido("eelog") || concedido("clip") || concedido("inventado") {
		t.Fatal("no se releyó bien del disco")
	}
}
