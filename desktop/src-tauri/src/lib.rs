// Backend nativo de VoidStonks Desktop.
//
// FASE 2 (esto): solo arranca la ventana con la app web (deploy/) dentro. No hace nada
// más — es deliberado, para validar que la app carga y el scanner funciona en el WebView
// antes de invertir en lo siguiente.
//
// FASE 3 (pendiente): aquí vivirá el "puente nativo" que describe
// deploy/js/utils/native_bridge.contract.md. Los comandos #[tauri::command] harán el
// login contra warframe.market DIRECTO desde este proceso Rust —sin CORS ni HttpOnly,
// como un script—, de modo que la contraseña del usuario nunca pase por el worker. El
// front lo detectará vía globalThis.__vsNative (ver deploy/js/utils/platform.js).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // opener: abrir enlaces externos (warframe.market, foros) en el navegador del
        // sistema en vez de dentro de la app. El resto de plugins se añadirán con el
        // puente nativo.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error al arrancar VoidStonks Desktop");
}
