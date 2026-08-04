// Punto de entrada del binario de escritorio.
//
// `windows_subsystem = "windows"` evita que se abra una consola detrás de la ventana en
// Windows; en Linux no tiene efecto. En debug se deja la consola para ver logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    voidstonks_desktop_lib::run()
}
