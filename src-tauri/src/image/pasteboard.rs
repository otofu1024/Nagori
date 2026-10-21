// 画像をNSPasteboardへ書く。NSImageとして書き、元のデータの型も添えるため、
// プレビューやメモなど、どのアプリでも画像として貼り付けられる。
// objcを直接呼ぶのはapple_quit.rsと同じで、新しい依存を増やさないため
use super::{Error, Image, Result};
use std::ffi::{c_char, c_void, CStr};

type Id = *mut c_void;
type Sel = *mut c_void;

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}

#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
}

fn sel(name: &CStr) -> Sel {
    unsafe { sel_registerName(name.as_ptr()) }
}

fn class(name: &CStr) -> Id {
    unsafe { objc_getClass(name.as_ptr()) }
}

// 引数の数と戻り値の型ごとに objc_msgSend を呼び分ける。整数とポインタは同じ渡し方で扱える
unsafe fn send0(receiver: Id, name: &CStr) -> Id {
    let send: unsafe extern "C" fn(Id, Sel) -> Id =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    send(receiver, sel(name))
}

unsafe fn send1(receiver: Id, name: &CStr, a: Id) -> Id {
    let send: unsafe extern "C" fn(Id, Sel, Id) -> Id =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    send(receiver, sel(name), a)
}

unsafe fn send2(receiver: Id, name: &CStr, a: Id, b: Id) -> Id {
    let send: unsafe extern "C" fn(Id, Sel, Id, Id) -> Id =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    send(receiver, sel(name), a, b)
}

// BOOLを返すメソッドは、戻り値を bool として受ける
unsafe fn send1_bool(receiver: Id, name: &CStr, a: Id) -> bool {
    let send: unsafe extern "C" fn(Id, Sel, Id) -> bool =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    send(receiver, sel(name), a)
}

unsafe fn send2_bool(receiver: Id, name: &CStr, a: Id, b: Id) -> bool {
    let send: unsafe extern "C" fn(Id, Sel, Id, Id) -> bool =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    send(receiver, sel(name), a, b)
}

// Cの文字列からNSStringを作る。返り値は自動解放される
unsafe fn ns_string(text: &CStr) -> Id {
    send1(
        class(c"NSString"),
        c"stringWithUTF8String:",
        text.as_ptr() as Id,
    )
}

// 自動解放されるオブジェクトを、呼び出しの間だけ解放する。バックグラウンドのスレッドにはプールがないため
fn in_pool<T>(task: impl FnOnce() -> T) -> T {
    unsafe {
        let pool = objc_autoreleasePoolPush();
        let result = task();
        objc_autoreleasePoolPop(pool);
        result
    }
}

pub(super) fn general() -> Id {
    unsafe { send0(class(c"NSPasteboard"), c"generalPasteboard") }
}

// 画像を、与えられたペーストボードへ書く
pub(super) fn write(pasteboard: Id, image: &Image) -> Result<()> {
    in_pool(|| unsafe { write_image(pasteboard, image) })
}

unsafe fn write_image(pasteboard: Id, image: &Image) -> Result<()> {
    send0(pasteboard, c"clearContents");
    let data = send2(
        class(c"NSData"),
        c"dataWithBytes:length:",
        image.data.as_ptr() as Id,
        image.data.len() as Id,
    );
    let picture = send0(
        send1(send0(class(c"NSImage"), c"alloc"), c"initWithData:", data),
        c"autorelease",
    );
    if picture.is_null() {
        return Err(Error::new("IMAGE", "画像を読み込めません。"));
    }
    // NSImageとして書き、ほかのアプリが画像として扱えるようにする
    let pictures = send1(class(c"NSArray"), c"arrayWithObject:", picture);
    if !send1_bool(pasteboard, c"writeObjects:", pictures) {
        return Err(Error::new(
            "CLIPBOARD",
            "クリップボードに画像を書けません。",
        ));
    }
    // 元のデータの型も添える。PNGやJPEGのまま受け取るアプリはこちらを使う
    if !send2_bool(
        pasteboard,
        c"setData:forType:",
        data,
        ns_string(image.uti()),
    ) {
        return Err(Error::new(
            "CLIPBOARD",
            "クリップボードに画像を書けません。",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::CString, io};

    // 一般のクリップボードは書き換えず、テスト専用の名前付きのペーストボードへ書いて読み戻す
    #[test]
    fn writes_the_image_to_a_named_pasteboard_and_reads_it_back() {
        let mut png = io::Cursor::new(Vec::new());
        image::RgbaImage::new(3, 2)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let picture = Image {
            data: png.into_inner(),
            format: image::ImageFormat::Png,
        };
        let name = CString::new(format!("nagori-test-{}", std::process::id())).unwrap();
        in_pool(|| unsafe {
            let pasteboard = send1(
                class(c"NSPasteboard"),
                c"pasteboardWithName:",
                ns_string(&name),
            );
            write(pasteboard, &picture).unwrap();
            // 元のPNGの型として、同じバイト列が読めるか
            let data = send1(pasteboard, c"dataForType:", ns_string(c"public.png"));
            assert!(!data.is_null());
            let length = send0(data, c"length") as usize;
            let bytes = std::slice::from_raw_parts(send0(data, c"bytes") as *const u8, length);
            assert_eq!(bytes, picture.data);
            // NSImageとしても読めるか
            let read = send1(
                send0(class(c"NSImage"), c"alloc"),
                c"initWithPasteboard:",
                pasteboard,
            );
            assert!(!read.is_null());
            send0(pasteboard, c"releaseGlobally");
        });
    }
}
