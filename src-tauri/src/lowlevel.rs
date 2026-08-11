//! Low-level keyboard + mouse hotkey hook.
//!
//! Why this exists: `RegisterHotKey` (what Tauri's global-shortcut plugin uses)
//! CONSUMES the keystroke - fine for F-keys + chords, but it means a bare "5"
//! binding would prevent typing the digit 5 anywhere (chat, browser, anything).
//!
//! Solution: use `rdev` (which uses `WH_KEYBOARD_LL` + `WH_MOUSE_LL` on Windows
//! - the same low-level hooks OBS / AutoHotkey / ReWASD / Steam Input use).
//! These hooks are PASS-THROUGH by design: we observe the input, fire our
//! callback, and let the OS deliver the keystroke to the focused window
//! normally. Binding "5" to the timer still lets you type 5 in chat AND cycles
//! the timer.
//!
//! Bindings live in a single static HashMap keyed by the chord string ("5",
//! "A", "M3", "WheelUp", ...) and valued by the action ID ("cycle" / "swap").
//! When the listener thread sees a matching event, it emits
//! `lowlevel-hotkey-fired` to the frontend with the action ID, and the bridge
//! in src/lib/lowlevelBridge.ts dispatches to `window.__hotkey1v1*`.
//!
//! Kill-switch: pressing Ctrl+Alt+Shift+F12 sets a global "killed" flag that
//! disables ALL low-level firing until the app restarts. Escape hatch if
//! anything ever misbehaves.

use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use rdev::{Button, Event, EventType, Key};
use tauri::{AppHandle, Emitter};

// Windows-only OS-truth modifier query. See `get_held_modifiers` for why we
// don't trust our shadow MOD_STATE for modifier checks. GetAsyncKeyState is a
// pure read API - no input registration, no consumption, no impact on the
// pass-through hook guarantee.
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN,
};

/// chord-string -> action ID. Multiple chords can map to the same action,
/// but we typically expect one entry per action.
static BINDINGS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Modifier-key state. rdev fires individual KeyPress/KeyRelease events for
/// Ctrl/Alt/Shift; we maintain a rolling state so we know whether a press is
/// the first physical edge (used by the bare-modifier-as-hotkey path).
#[derive(Default)]
struct ModState {
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
}
static MOD_STATE: Lazy<Mutex<ModState>> = Lazy::new(|| Mutex::new(ModState::default()));

/// Global kill-switch. Set true by Ctrl+Alt+Shift+F12. Resets on app restart.
static KILLED: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

/// Per-modifier "bare-key" switches. When a modifier is `true` here it is
/// treated as a *bare key* - it no longer reserves itself as a chord prefix,
/// so a bare binding (e.g. "F") still fires while that modifier is held
/// (e.g. Ctrl+F fires the "F" binding). When `false` the modifier behaves as a
/// combo prefix.
///
/// This only shapes runtime *matching* - explicitly-bound combos still win
/// (see `candidate_chords`). The frontend pushes these once on startup so the
/// setting survives restarts.
#[derive(Default)]
struct BareMods {
    ctrl: bool,
    alt: bool,
    shift: bool,
}
static BARE_MODS: Lazy<Mutex<BareMods>> = Lazy::new(|| Mutex::new(BareMods::default()));

/// Update the per-modifier bare-key switches. Called from the `set_bare_modifiers`
/// Tauri command.
pub fn set_bare_modifiers(ctrl: bool, alt: bool, shift: bool) {
    let mut b = BARE_MODS.lock().unwrap();
    b.ctrl = ctrl;
    b.alt = alt;
    b.shift = shift;
}

/// Map an rdev `Key` to the chord-string fragment we use everywhere.
/// Returns None for keys we don't bind (modifiers are tracked separately).
///
/// F-keys are intentionally included here rather than routed through
/// `RegisterHotKey`: that path had a subtle bug where opening the rebind
/// recorder could let the unregister call lag behind the next keypress at the
/// OS level, swallowing F1/F2 before they reached the webview - the recorder's
/// keydown listener never fired and the UI froze in "PRESS…" mode. Going
/// through the pass-through hook makes pausing a binding just a HashMap remove.
fn key_to_chord(k: Key) -> Option<String> {
    use Key::*;
    let s = match k {
        // Letters
        KeyA => "A", KeyB => "B", KeyC => "C", KeyD => "D", KeyE => "E",
        KeyF => "F", KeyG => "G", KeyH => "H", KeyI => "I", KeyJ => "J",
        KeyK => "K", KeyL => "L", KeyM => "M", KeyN => "N", KeyO => "O",
        KeyP => "P", KeyQ => "Q", KeyR => "R", KeyS => "S", KeyT => "T",
        KeyU => "U", KeyV => "V", KeyW => "W", KeyX => "X", KeyY => "Y",
        KeyZ => "Z",
        // Top-row digits
        Num0 => "0", Num1 => "1", Num2 => "2", Num3 => "3", Num4 => "4",
        Num5 => "5", Num6 => "6", Num7 => "7", Num8 => "8", Num9 => "9",
        // Numpad - collapse to the same digit-chord so users don't have to
        // care whether they pressed top-row 5 or numpad 5.
        Kp0 => "0", Kp1 => "1", Kp2 => "2", Kp3 => "3", Kp4 => "4",
        Kp5 => "5", Kp6 => "6", Kp7 => "7", Kp8 => "8", Kp9 => "9",
        // F-keys - see comment on this fn for why these go through low-level.
        F1  => "F1",  F2  => "F2",  F3  => "F3",  F4  => "F4",
        F5  => "F5",  F6  => "F6",  F7  => "F7",  F8  => "F8",
        F9  => "F9",  F10 => "F10", F11 => "F11", F12 => "F12",
        // Misc useful bare keys
        Space => "Space",
        Tab => "Tab",
        CapsLock => "CapsLock",
        // The `/~ key (left of "1" on US layouts). rdev calls this BackQuote
        // regardless of whether Shift is held, so we use the same name as the
        // chord-string. validate_key() in main.rs accepts it (ASCII alpha).
        BackQuote => "Backquote",
        Backspace => "Backspace",
        Return => "Enter",
        Insert => "Insert",
        Delete => "Delete",
        Home => "Home",
        End => "End",
        PageUp => "PageUp",
        PageDown => "PageDown",
        UpArrow => "Up",
        DownArrow => "Down",
        LeftArrow => "Left",
        RightArrow => "Right",
        _ => return None,
    };
    Some(s.to_string())
}

/// Map an rdev modifier key to its chord-string ("Ctrl"/"Alt"/"Shift"). Used
/// by the bare-modifier-as-hotkey path in `handle_event`: when one of the
/// per-modifier bare-key switches is on AND the modifier has a binding, a
/// physical press of that modifier alone fires the action. The standard
/// `key_to_chord` deliberately doesn't map these - modifiers there are still
/// reserved for chord prefixes; this is the explicit opt-in route.
fn modifier_key_to_chord(k: Key) -> Option<&'static str> {
    match k {
        Key::ControlLeft | Key::ControlRight => Some("Ctrl"),
        Key::Alt         | Key::AltGr        => Some("Alt"),
        Key::ShiftLeft   | Key::ShiftRight   => Some("Shift"),
        _ => None,
    }
}

/// Map an rdev `Button` to its chord-string. Left + Right are intentionally
/// excluded - left-click is the recorder's "start capture" trigger and
/// right-click should remain the context-menu button.
///
/// rdev maps the Windows X-button1/X-button2 to `Unknown(1)` / `Unknown(2)`
/// on most builds.
fn button_to_chord(b: Button) -> Option<String> {
    match b {
        Button::Middle => Some("M3".into()),
        Button::Unknown(1) => Some("M4".into()),
        Button::Unknown(2) => Some("M5".into()),
        _ => None,
    }
}

/// Returns true when this press/release flipped the modifier's state - i.e.
/// it's the first physical edge, not one of rdev's auto-repeats.
fn update_modifier(k: Key, pressed: bool) -> bool {
    let mut st = MOD_STATE.lock().unwrap();
    match k {
        Key::ControlLeft | Key::ControlRight => { let prev = st.ctrl;  st.ctrl  = pressed; prev != pressed },
        Key::Alt        | Key::AltGr         => { let prev = st.alt;   st.alt   = pressed; prev != pressed },
        Key::ShiftLeft  | Key::ShiftRight    => { let prev = st.shift; st.shift = pressed; prev != pressed },
        Key::MetaLeft   | Key::MetaRight     => { let prev = st.meta;  st.meta  = pressed; prev != pressed },
        _ => false,
    }
}

/// True iff either Windows key is physically held right now according to the OS.
///
/// Used as the bare-key guard: Win combos (Win+F, Win+E, ...) aren't bindable -
/// the recorder never emits them - so a modifier-less binding must not hijack
/// one. We check the Windows key specifically (not Ctrl/Alt/Shift) because those
/// three are governed by the per-modifier bare-key switches in
/// `candidate_chords`; folding them in here would defeat the switch.
///
/// Why we ask the OS instead of trusting `MOD_STATE`: rdev's KeyPress /
/// KeyRelease events are reliable *most* of the time, but Windows can and
/// does swallow modifier-release events in certain conditions - Alt-Tab
/// into a fullscreen game, focus switches, UAC prompts, the shell stealing
/// Alt for menu mode. When that happens, our shadow state stays stuck and
/// every bare-key binding silently no-ops until the user taps that modifier
/// again. `GetAsyncKeyState` returns physical key state - the high bit
/// (0x8000) is set while the key is down.
#[cfg(target_os = "windows")]
fn win_held() -> bool {
    // SAFETY: GetAsyncKeyState is a read-only Win32 call with no preconditions.
    // It takes a virtual-key code and returns an i16; we never dereference
    // anything, never write memory, and the call is reentrant-safe.
    unsafe {
        let down = |vk: VIRTUAL_KEY| (GetAsyncKeyState(vk.0 as i32) as u16) & 0x8000 != 0;
        down(VK_LWIN) || down(VK_RWIN)
    }
}

/// Fallback for non-Windows builds. We only ship Windows today, but keeping
/// this means the file still compiles under `cargo check` elsewhere.
#[cfg(not(target_os = "windows"))]
fn win_held() -> bool {
    MOD_STATE.lock().unwrap().meta
}

/// Returns (ctrl, alt, shift) physical state from the OS.
/// Using GetAsyncKeyState instead of MOD_STATE because Windows can swallow
/// modifier-release events on focus switches (e.g. Alt-Tab, switching monitors),
/// leaving MOD_STATE permanently stuck in "Shift held" - causing every bare-key
/// press to silently compose "Shift+X" and fire nothing.
#[cfg(target_os = "windows")]
fn get_held_modifiers() -> (bool, bool, bool) {
    // SAFETY: same as win_held - read-only Win32 calls.
    unsafe {
        let down = |vk: VIRTUAL_KEY| (GetAsyncKeyState(vk.0 as i32) as u16) & 0x8000 != 0;
        (down(VK_CONTROL), down(VK_MENU), down(VK_SHIFT))
    }
}

#[cfg(not(target_os = "windows"))]
fn get_held_modifiers() -> (bool, bool, bool) {
    let st = MOD_STATE.lock().unwrap();
    (st.ctrl, st.alt, st.shift)
}

/// True when Ctrl + Alt + Shift are all currently physically held.
///
/// Also on the OS-truth API: if our shadow state can drift "stuck on", it could
/// spuriously fire the kill-switch (which would silently disable all bindings
/// until app restart - much worse than the bug we're fixing).
#[cfg(target_os = "windows")]
fn mods_match_killswitch() -> bool {
    // SAFETY: same as win_held - read-only Win32 calls.
    unsafe {
        let down = |vk: VIRTUAL_KEY| (GetAsyncKeyState(vk.0 as i32) as u16) & 0x8000 != 0;
        down(VK_CONTROL) && down(VK_MENU) && down(VK_SHIFT)
    }
}

#[cfg(not(target_os = "windows"))]
fn mods_match_killswitch() -> bool {
    let st = MOD_STATE.lock().unwrap();
    st.ctrl && st.alt && st.shift
}

/// Add or replace the binding for an action. Removes any existing chord
/// mapped to the same action first so there's never a stale entry.
pub fn register(action: &str, chord: &str) {
    let mut map = BINDINGS.lock().unwrap();
    map.retain(|_, v| v != action);
    map.insert(chord.to_string(), action.to_string());
}

/// Remove a specific chord regardless of which action it belongs to.
pub fn unregister_chord(chord: &str) {
    let mut map = BINDINGS.lock().unwrap();
    map.remove(chord);
}

/// Spawn the listener thread. Called once from `main()` during setup. The
/// thread runs for the app lifetime - rdev's `listen` is a blocking call,
/// so it lives on its own thread and we never join.
pub fn start_listener(app: AppHandle) {
    std::thread::spawn(move || {
        // Single info line so the dev terminal confirms the listener is alive.
        // Anything past this point is silent unless the hook actually exits
        // (which would be a real problem to investigate).
        eprintln!("[lowlevel] listener started");
        let res = rdev::listen(move |event| handle_event(event, &app));
        eprintln!("[lowlevel] listener exited: {:?}", res);
    });
}

/// Build the ordered list of chord-strings to look up for a bare fragment
/// ("5", "F", "M5", "WheelUp", ...), honoring the per-modifier bare-key
/// switches. The caller tries each candidate in order and fires the first one
/// bound - so earlier candidates take precedence.
///
/// Candidate 1 - the *full* chord: every physically-held Ctrl/Alt/Shift
/// prefixed in canonical Ctrl→Alt→Shift order, exactly as the recorder UI
/// emits. Checked first, so an explicitly-bound combo like "Ctrl+F" always
/// wins over a bare "F" binding.
///
/// Candidate 2 - the *reduced* chord (only added when it differs): the held
/// modifiers that are in *bare* mode are stripped, leaving only the combo-mode
/// modifiers. This is what lets a bare "F" binding fire while Ctrl is held
/// *when Ctrl is switched to bare mode* - Ctrl+F finds no "Ctrl+F" binding,
/// then falls back to "F".
///
/// Win-key guard: a modifier-less candidate must not fire while a Windows key
/// is physically held - Win combos aren't bindable, so a bare binding shouldn't
/// hijack e.g. Win+F. Such candidates are dropped; candidates still carrying a
/// combo-mode modifier are kept.
fn candidate_chords(bare: &str) -> Vec<String> {
    let (ctrl, alt, shift) = get_held_modifiers();
    let bare_mode = {
        let b = BARE_MODS.lock().unwrap();
        (b.ctrl, b.alt, b.shift)
    };

    let build = |with_ctrl: bool, with_alt: bool, with_shift: bool| -> String {
        let mut mods: Vec<&str> = Vec::new();
        if with_ctrl  { mods.push("Ctrl");  }
        if with_alt   { mods.push("Alt");   }
        if with_shift { mods.push("Shift"); }
        if mods.is_empty() {
            bare.to_string()
        } else {
            format!("{}+{}", mods.join("+"), bare)
        }
    };

    // Full chord - every held modifier, regardless of mode.
    let full = build(ctrl, alt, shift);
    // Reduced chord - held modifiers in bare mode dropped, combo-mode kept.
    let reduced = build(ctrl && !bare_mode.0, alt && !bare_mode.1, shift && !bare_mode.2);

    let mut candidates = vec![full];
    if reduced != candidates[0] {
        candidates.push(reduced);
    }

    // Drop any modifier-less candidate while a Windows key is held.
    if win_held() {
        candidates.retain(|c| c.contains('+'));
    }

    candidates
}

fn handle_event(event: Event, app: &AppHandle) {
    // Update modifier state on every key press/release regardless of the kill
    // flag, so kill-switch detection still works after re-enabling. Capture
    // whether the press is the FIRST physical edge - rdev fires repeats while
    // a modifier is held, and bare-modifier hotkeys must only fire once per
    // physical press.
    let mod_edge = match event.event_type {
        EventType::KeyPress(k)   => update_modifier(k, true),
        EventType::KeyRelease(k) => { update_modifier(k, false); false }
        _ => false,
    };

    // Kill-switch check on F12 press with Ctrl+Alt+Shift held.
    if let EventType::KeyPress(Key::F12) = event.event_type {
        if mods_match_killswitch() {
            let mut killed = KILLED.lock().unwrap();
            if !*killed {
                *killed = true;
                let _ = app.emit("lowlevel-killed", ());
                eprintln!("[lowlevel] KILL-SWITCH activated - hotkeys disabled until restart");
            }
            return;
        }
    }

    if *KILLED.lock().unwrap() { return; }

    // Bare-modifier-as-hotkey path. Fires only on the first physical press
    // edge AND only when the corresponding bareMod toggle is on. Looks up the
    // modifier name directly so candidate_chords doesn't mangle it into a
    // self-prefixed chord like "Ctrl+Ctrl". A modifier press never falls
    // through to the standard matcher - letting it would mean Shift firing a
    // bare-shifted binding, which has no sensible semantics.
    if mod_edge {
        if let EventType::KeyPress(k) = event.event_type {
            if let Some(mod_chord) = modifier_key_to_chord(k) {
                let allow = {
                    let b = BARE_MODS.lock().unwrap();
                    match mod_chord {
                        "Ctrl"  => b.ctrl,
                        "Alt"   => b.alt,
                        "Shift" => b.shift,
                        _ => false,
                    }
                };
                if allow {
                    let action = BINDINGS.lock().unwrap().get(mod_chord).cloned();
                    if let Some(action) = action {
                        let _ = app.emit("lowlevel-hotkey-fired", action);
                    }
                }
                return;
            }
        }
    }

    // The bare fragment for this event ("F", "5", "M5", "WheelUp", ...).
    // Modifiers are folded in by candidate_chords, which also honors the
    // per-modifier bare-key switches. Mouse buttons and the scroll wheel go
    // through the same path, so "Ctrl+M5" / "Shift+WheelUp" stay bindable.
    let bare = match event.event_type {
        EventType::KeyPress(k)    => key_to_chord(k),
        EventType::ButtonPress(b) => button_to_chord(b),
        EventType::Wheel { delta_y, .. } => {
            if delta_y > 0 { Some("WheelUp".to_string()) }
            else if delta_y < 0 { Some("WheelDown".to_string()) }
            else { None }
        }
        _ => None,
    };

    let Some(bare) = bare else { return; };

    // Try each candidate in precedence order: an explicit combo wins, then the
    // bare-reduced fallback.
    let matched = {
        let map = BINDINGS.lock().unwrap();
        candidate_chords(&bare)
            .into_iter()
            .find_map(|c| map.get(&c).cloned())
    };

    if let Some(action) = matched {
        let _ = app.emit("lowlevel-hotkey-fired", action);
    }
}
