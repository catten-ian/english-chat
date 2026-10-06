#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn app_url() -> &'static str {
    "https://www.catten.cyou/english?version=dev"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_url])
        .run(tauri::generate_context!())
        .expect("error while running AI English Chat");
}
