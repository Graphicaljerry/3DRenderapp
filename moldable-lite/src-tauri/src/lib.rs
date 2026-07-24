// The whole app is the existing web build (../dist), rendered in a native window
// by the system WebView (WKWebView on macOS). No custom Rust logic — the shell just
// runs the webview. File-open / .3mf associations would be added here as a fast-follow.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Moldable");
}
