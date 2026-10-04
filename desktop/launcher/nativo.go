package main

import (
	"encoding/json"
	"io"
	"net/http"
	"runtime"
)

func soloLaApp(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") != "same-origin" {
		return false
	}
	return r.Method == http.MethodGet || r.Header.Get("X-VoidStonks") == "1"
}

var permisoDeRuta = map[string]string{
	"/__voidstonks/clip":    "clip",
	"/__voidstonks/eelog":   "eelog",
	"/__voidstonks/paneles": "overlay",
}

func nativo(w http.ResponseWriter, r *http.Request) bool {
	var h func(http.ResponseWriter, *http.Request)
	switch r.URL.Path {
	case "/__voidstonks/caps":
		h = servirCapacidades
	case "/__voidstonks/permisos":
		h = servirPermisos
	case "/__voidstonks/clip":
		h = servirCopia
	case "/__voidstonks/eelog":
		h = servirEELog
	case "/__voidstonks/paneles":
		h = servirPaneles
	default:
		return false
	}
	if !soloLaApp(r) {
		http.Error(w, "solo la app", http.StatusForbidden)
		return true
	}
	if id, ok := permisoDeRuta[r.URL.Path]; ok && !concedido(id) {
		http.Error(w, "permiso no concedido: "+id, http.StatusForbidden)
		return true
	}
	h(w, r)
	return true
}

func servirCapacidades(w http.ResponseWriter, _ *http.Request) {
	concedidos, pendientes := estadoPermisos()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"so":         runtime.GOOS,
		"clip":       puedeCopiar(),
		"eelog":      rutaEELog(),
		"overlay":    puedePintar(),
		"permisos":   concedidos,
		"pendientes": pendientes,
	})
}

func servirPermisos(w http.ResponseWriter, r *http.Request) {
	var nuevos map[string]bool
	if r.Method != http.MethodPost || json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&nuevos) != nil {
		http.Error(w, "POST {permiso: bool}", http.StatusBadRequest)
		return
	}
	if err := guardarPermisos(nuevos); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func servirCopia(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST", http.StatusMethodNotAllowed)
		return
	}
	texto, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err == nil {
		err = copiar(string(texto))
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
