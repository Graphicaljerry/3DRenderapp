// The whole app is the existing web build (../dist), rendered in a native window
// by the system WebView (WKWebView on macOS). The only native logic is the slicer
// hand-off below — the browser can't hand a slicer a local file, and the desktop can.

use std::path::PathBuf;
use tauri::{ipc::InvokeBody, Manager};

/// Park an export on disk where a slicer can open it, and return the path.
///
/// The path is STABLE for a given name: sending the same project again overwrites
/// the same file, so the slicer's "reload from disk" pulls in the new version and
/// keeps the print settings, supports and plate layout the user already tuned. That
/// round trip is the whole reason this writes a real file instead of a temp one.
///
/// The bytes arrive as the raw request body rather than a JSON array — a 3MF runs to
/// megabytes, and `Array.from(bytes)` would spend seconds turning each one into a
/// decimal string. The name rides in a header for the same reason.
#[tauri::command]
fn stage_for_slicer(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let name = request
        .headers()
        .get("x-moldable-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b,
        InvokeBody::Json(_) => return Err("expected the file bytes as the request body".into()),
    };
    let dir: PathBuf = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("no place to write the file: {e}"))?
        .join("handoff");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let path = dir.join(safe_file_name(name));
    std::fs::write(&path, bytes).map_err(|e| format!("couldn't write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// The name comes from a project title the user typed, so it is untrusted input.
/// Anything that is not plainly a filename character becomes a dash — that alone
/// removes both path separators and `..`'s ability to go anywhere. The .3mf suffix is
/// enforced rather than assumed, because it is what makes the OS open a slicer.
fn safe_file_name(name: &str) -> String {
    let is_sep = |c: char| c == '-' || c == ' ';
    let mut stem = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '_' | '.') {
            stem.push(c);
        } else {
            // One separator per run, so a name full of emoji or slashes doesn't come
            // back as a line of dashes.
            let sub = if c == ' ' { ' ' } else { '-' };
            if !stem.is_empty() && !stem.ends_with(is_sep) {
                stem.push(sub);
            }
        }
    }
    if stem.to_ascii_lowercase().ends_with(".3mf") {
        stem.truncate(stem.len() - 4);
    }
    stem.truncate(120); // everything left is ASCII, so bytes are chars
    let stem = stem.trim_matches(|c: char| is_sep(c) || c == '.');
    if stem.is_empty() {
        "model.3mf".to_string()
    } else {
        format!("{stem}.3mf")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Auth sessions live here rather than in WKWebView's localStorage, which the
        // system can clear out from under the app — signing in should stick.
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![stage_for_slicer]);

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

#[cfg(test)]
mod tests {
    use super::safe_file_name;

    #[test]
    fn keeps_ordinary_names_and_adds_one_extension() {
        assert_eq!(safe_file_name("Wall bracket.3mf"), "Wall bracket.3mf");
        assert_eq!(safe_file_name("Wall bracket"), "Wall bracket.3mf");
        assert_eq!(safe_file_name("v2_lid-final"), "v2_lid-final.3mf");
        // Case-insensitive, so a .3MF from the export layer doesn't get doubled up.
        assert_eq!(safe_file_name("lid.3MF"), "lid.3mf");
    }

    #[test]
    fn cannot_escape_the_handoff_folder() {
        assert_eq!(safe_file_name("../../etc/passwd"), "etc-passwd.3mf");
        assert_eq!(safe_file_name("..\\..\\windows\\system32"), "windows-system32.3mf");
        assert_eq!(safe_file_name("/absolute/path.3mf"), "absolute-path.3mf");
        assert_eq!(safe_file_name(".."), "model.3mf");
        assert_eq!(safe_file_name(""), "model.3mf");
        assert_eq!(safe_file_name("   "), "model.3mf");
    }

    #[test]
    fn strips_what_filesystems_object_to() {
        assert_eq!(safe_file_name("a:b*c?d\"e<f>g|h"), "a-b-c-d-e-f-g-h.3mf");
        assert_eq!(safe_file_name("café ☕ holder"), "caf-holder.3mf");
        // A trailing dot or space is invalid on Windows even though it survives the
        // character filter, so the stem is trimmed at both ends.
        assert_eq!(safe_file_name("lid. "), "lid.3mf");
        assert!(safe_file_name(&"x".repeat(400)).len() <= 124);
    }
}
