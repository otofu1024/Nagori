// 終了のApple Event(Dock終了、osascript、ログアウトなど)は、tao 0.37では
// applicationWillTerminateへ直行し、ExitRequestedもフロントの保存も通らない。
// そこでデリゲートへapplicationShouldTerminate:を足し、保存が済むまで終了を取り消す。
use crate::commands::Backend;
use std::ffi::{c_char, c_void};
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use tauri::{Emitter, Manager};

type Id = *mut c_void;
type Sel = *mut c_void;

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
    fn object_getClass(object: Id) -> Id;
    fn class_addMethod(class: Id, name: Sel, imp: *const c_void, types: *const c_char) -> bool;
}

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

// NSTerminateCancel = 0、NSTerminateNow = 1
extern "C" fn should_terminate(_this: Id, _sel: Sel, _sender: Id) -> usize {
    let Some(app) = APP.get() else { return 1 };
    if app.state::<Backend>().allow_exit.load(Ordering::SeqCst) {
        return 1;
    }
    let _ = app.emit("nagori:quit-requested", ());
    0
}

pub fn install(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    unsafe {
        let send: unsafe extern "C" fn(Id, Sel) -> Id =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let ns_app = send(
            objc_getClass(c"NSApplication".as_ptr()),
            sel_registerName(c"sharedApplication".as_ptr()),
        );
        let delegate = send(ns_app, sel_registerName(c"delegate".as_ptr()));
        if delegate.is_null() {
            return;
        }
        class_addMethod(
            object_getClass(delegate),
            sel_registerName(c"applicationShouldTerminate:".as_ptr()),
            should_terminate as *const c_void,
            c"Q@:@".as_ptr(),
        );
    }
}
