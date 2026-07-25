// The whole app is the existing web build (../dist), rendered in a native window
// by the system WebView (WKWebView on macOS). No custom Rust logic — the shell just
// runs the webview. File-open / .3mf associations would be added here as a fast-follow.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // Silent updates (desktop only): the frontend checks the rolling release, then
    // downloads + installs in the background and offers a restart. Signature checking
    // is enforced by the plugin against the pubkey in tauri.conf.json.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running Moldable");
}
