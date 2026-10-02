package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

// Lo concedido vive en el lanzador y no en la página: los endpoints lo comprueban, así que ni un
// fallo de la web puede saltárselo.
var permisosConocidos = []string{"eelog", "clip", "overlay"}

type permisos struct {
	Concedidos  map[string]bool `json:"concedidos"`
	Preguntados []string        `json:"preguntados"`
}

var (
	muPermisos   sync.Mutex
	rutaPermisos = filepath.Join(dirDatos(), "permisos.json")
	cargados     *permisos
)

func actuales() permisos {
	if cargados == nil {
		p := permisos{}
		if b, err := os.ReadFile(rutaPermisos); err == nil {
			json.Unmarshal(b, &p)
		}
		if p.Concedidos == nil {
			p.Concedidos = map[string]bool{}
		}
		cargados = &p
	}
	return *cargados
}

func concedido(id string) bool {
	muPermisos.Lock()
	defer muPermisos.Unlock()
	return actuales().Concedidos[id]
}

// Los que esta versión conoce y el usuario aún no ha visto: una actualización que añade uno
// pregunta solo por ese.
func estadoPermisos() (map[string]bool, []string) {
	muPermisos.Lock()
	defer muPermisos.Unlock()
	p := actuales()
	concedidos := map[string]bool{}
	pendientes := []string{}
	for _, id := range permisosConocidos {
		concedidos[id] = p.Concedidos[id]
		if !slices.Contains(p.Preguntados, id) {
			pendientes = append(pendientes, id)
		}
	}
	return concedidos, pendientes
}

func guardarPermisos(nuevos map[string]bool) error {
	muPermisos.Lock()
	defer muPermisos.Unlock()
	p := actuales()
	concedidos := map[string]bool{}
	for id, v := range p.Concedidos {
		concedidos[id] = v
	}
	preguntados := slices.Clone(p.Preguntados)
	for _, id := range permisosConocidos {
		v, ok := nuevos[id]
		if !ok {
			continue
		}
		concedidos[id] = v
		if !slices.Contains(preguntados, id) {
			preguntados = append(preguntados, id)
		}
	}
	nuevo := permisos{Concedidos: concedidos, Preguntados: preguntados}
	b, err := json.MarshalIndent(nuevo, "", "  ")
	if err == nil {
		err = os.MkdirAll(filepath.Dir(rutaPermisos), 0o700)
	}
	if err == nil {
		err = os.WriteFile(rutaPermisos, b, 0o600)
	}
	if err == nil {
		cargados = &nuevo
	}
	return err
}
