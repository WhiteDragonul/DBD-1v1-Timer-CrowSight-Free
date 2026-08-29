// Hide the console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};

mod lowlevel;

/// Validates that a key string is safe to pass through:
/// max 50 chars, only ASCII alphanumerics, '+', '_', '-'. Chord-strings like
/// "F5", "Ctrl+5", "Shift+A", "M3", "WheelUp", "Up", "Space" all match.
fn validate_key(k: &str) -> bool {
    k.len() <= 50
        && !k.is_empty()
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '_' || c == '-')
}

// === 1v1 Timer hotkey commands (registered only while the overlay is open) ===
//
// cycle_key -> fires window.__hotkey1v1Cycle() (Start / Stop / Reset cycle)
// swap_key  -> fires window.__hotkey1v1Swap()  (save active player's time, swap)
//
// Every binding goes through the low-level pass-through hook in lowlevel.rs -
// never RegisterHotKey. That matters: RegisterHotKey CONSUMES the keystroke, so
// a bare "5" binding would stop the digit 5 from reaching any other app. The
// WH_KEYBOARD_LL hook observes the input, fires the action, and lets the OS
// deliver the keystroke normally.
//
// Registration is scoped to the overlay's lifetime so that when the overlay is
// closed the bound keys are free for other use.

#[tauri::command]
fn register_1v1_hotkeys(cycle_key: String, swap_key: String) {
    if !validate_key(&cycle_key) || !validate_key(&swap_key) { return; }
    // Idempotent: clear any prior bindings first.
    lowlevel::unregister_chord(&cycle_key);
    lowlevel::unregister_chord(&swap_key);
    lowlevel::register("cycle", &cycle_key);
    lowlevel::register("swap", &swap_key);
}

#[tauri::command]
fn unregister_1v1_hotkeys(cycle_key: String, swap_key: String) {
    if !validate_key(&cycle_key) || !validate_key(&swap_key) { return; }
    lowlevel::unregister_chord(&cycle_key);
    lowlevel::unregister_chord(&swap_key);
}

/// Unregister a single chord without registering anything in its place. Used by
/// the frontend rebinder so that, while the user is in "Press a key…" mode, the
/// currently-bound key isn't intercepted - letting the webview see the keydown.
#[tauri::command]
fn unregister_hotkey(key: String) {
    if !validate_key(&key) { return; }
    lowlevel::unregister_chord(&key);
}

/// Bind a Perk Timer action to a chord, replacing whatever it answered to
/// before. `old_key` is dropped first so a rebind never leaves the previous
/// chord live, and passing the same key twice is the idempotent
/// "(re-)assert this binding" call the frontend makes on mount.
///
/// Actions are whitelisted: "ds" is the shared Perk Timer key, "perk_<id>" is
/// a row that carries its own. Everything else is ignored rather than trusted.
#[tauri::command]
fn rebind_hotkey(action: String, old_key: String, new_key: String) {
    if !validate_key(&old_key) || !validate_key(&new_key) { return; }
    if !matches!(action.as_str(), "ds" | "perk_bt" | "perk_elusive") { return; }
    lowlevel::unregister_chord(&old_key);
    lowlevel::register(&action, &new_key);
}

/// Bridge: lock/unlock the overlay's cursor-passthrough state from the main
/// window. Routing it through here keeps the lock state authoritative on one
/// side (the control panel).
#[tauri::command]
fn set_1v1_overlay_lock(app: tauri::AppHandle, locked: bool) {
    if let Some(window) = app.get_webview_window("1v1-overlay") {
        let _ = window.set_ignore_cursor_events(locked);
    }
    let _ = app.emit("overlay-1v1-lock-changed", locked);
}

/// Choose whether each of Ctrl/Alt/Shift is treated as a bare key (ignored when
/// matching a bare-key binding, so e.g. Ctrl+F fires an "F" binding) or as a
/// combo prefix. Pushed from the frontend once on startup so the preference
/// survives restarts.
#[tauri::command]
fn set_bare_modifiers(ctrl: bool, alt: bool, shift: bool) {
    lowlevel::set_bare_modifiers(ctrl, alt, shift);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            register_1v1_hotkeys,
            unregister_1v1_hotkeys,
            unregister_hotkey,
            rebind_hotkey,
            set_1v1_overlay_lock,
            set_bare_modifiers
        ])
        .setup(|app| {
            // Spawn the low-level keyboard+mouse listener once for the app
            // lifetime. Bindings start empty; the frontend populates them via
            // register_1v1_hotkeys when the overlay opens.
            lowlevel::start_listener(app.handle().clone());

            // When the main window closes, destroy the overlay window too so no
            // orphaned transparent window keeps the process alive.
            if let Some(main_win) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        for label in ["1v1-overlay", "ds-overlay", "crosshair-overlay"] {
                            if let Some(w) = app_handle.get_webview_window(label) {
                                let _ = w.destroy();
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
