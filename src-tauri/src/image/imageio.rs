use super::{read_image_file, Error, Result, IMAGE_LIMIT, PIXEL_LIMIT, PREVIEW_EDGE};
use std::{ffi::c_void, fs::File, os::fd::AsRawFd, ptr};

// フレームワークごとにextern "C"のブロックを分ける。1つのブロックに複数の#[link]を並べると、
// リンク指定が重複したとclippyに指摘されるため
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: *const c_void;
    static kCFBooleanFalse: *const c_void;
    // コールバックはアドレスだけを渡すため、中身の型は問わない
    static kCFTypeDictionaryKeyCallBacks: u8;
    static kCFTypeDictionaryValueCallBacks: u8;

    fn CFRelease(cf: *const c_void);
    fn CFEqual(first: *const c_void, second: *const c_void) -> bool;
    fn CFURLCreateFromFileSystemRepresentation(
        allocator: *const c_void,
        bytes: *const u8,
        length: isize,
        is_directory: bool,
    ) -> *const c_void;
    fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *const c_void;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFStringCreateWithBytes(
        allocator: *const c_void,
        bytes: *const u8,
        length: isize,
        encoding: u32,
        is_external_representation: bool,
    ) -> *const c_void;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
    fn CFDictionaryGetValue(dictionary: *const c_void, key: *const c_void) -> *const c_void;
    fn CFNumberCreate(
        allocator: *const c_void,
        number_type: isize,
        value: *const c_void,
    ) -> *const c_void;
    fn CFNumberGetValue(number: *const c_void, number_type: isize, value: *mut c_void) -> bool;
}
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGImageGetAlphaInfo(image: *const c_void) -> u32;
}
#[link(name = "ImageIO", kind = "framework")]
unsafe extern "C" {
    static kCGImageSourceCreateThumbnailFromImageAlways: *const c_void;
    static kCGImageSourceCreateThumbnailWithTransform: *const c_void;
    static kCGImageSourceShouldCacheImmediately: *const c_void;
    static kCGImageSourceThumbnailMaxPixelSize: *const c_void;
    static kCGImagePropertyPixelWidth: *const c_void;
    static kCGImagePropertyPixelHeight: *const c_void;
    static kCGImageDestinationLossyCompressionQuality: *const c_void;

    fn CGImageSourceCreateWithURL(url: *const c_void, options: *const c_void) -> *const c_void;
    fn CGImageSourceGetType(source: *const c_void) -> *const c_void;
    fn CGImageSourceGetCount(source: *const c_void) -> usize;
    fn CGImageSourceCopyPropertiesAtIndex(
        source: *const c_void,
        index: usize,
        options: *const c_void,
    ) -> *const c_void;
    fn CGImageSourceCreateThumbnailAtIndex(
        source: *const c_void,
        index: usize,
        options: *const c_void,
    ) -> *const c_void;
    fn CGImageDestinationCreateWithData(
        data: *const c_void,
        uti: *const c_void,
        count: usize,
        options: *const c_void,
    ) -> *const c_void;
    fn CGImageDestinationAddImage(
        destination: *const c_void,
        image: *const c_void,
        properties: *const c_void,
    );
    fn CGImageDestinationFinalize(destination: *const c_void) -> bool;
}

// CFNumberTypeとCFStringEncodingの値。ヘッダーで定められた定数
const CF_NUMBER_SINT32: isize = 3;
const CF_NUMBER_SINT64: isize = 4;
const CF_NUMBER_FLOAT64: isize = 6;
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

// 所有権を持つCF参照。Dropで解放するため、途中で失敗しても参照は漏れない
struct Cf(*const c_void);
impl Drop for Cf {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

fn failed() -> Error {
    Error::new("IMAGE", "画像を縮小できませんでした。")
}
// Create/Copyで得た参照を受け取る。nullなら失敗として扱う
fn owned(ptr: *const c_void) -> Result<Cf> {
    if ptr.is_null() {
        return Err(failed());
    }
    Ok(Cf(ptr))
}
fn string(text: &str) -> Result<Cf> {
    owned(unsafe {
        CFStringCreateWithBytes(
            ptr::null(),
            text.as_ptr(),
            text.len() as isize,
            CF_STRING_ENCODING_UTF8,
            false,
        )
    })
}
fn number<T>(number_type: isize, value: &T) -> Result<Cf> {
    owned(unsafe { CFNumberCreate(ptr::null(), number_type, (value as *const T).cast()) })
}
fn dictionary(pairs: &[(*const c_void, *const c_void)]) -> Result<Cf> {
    let keys: Vec<*const c_void> = pairs.iter().map(|&(key, _)| key).collect();
    let values: Vec<*const c_void> = pairs.iter().map(|&(_, value)| value).collect();
    owned(unsafe {
        CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            pairs.len() as isize,
            ptr::addr_of!(kCFTypeDictionaryKeyCallBacks).cast(),
            ptr::addr_of!(kCFTypeDictionaryValueCallBacks).cast(),
        )
    })
}
// 展開せずにプロパティから整数の値を読む。値がなければNone
fn property(properties: &Cf, key: *const c_void) -> Option<i64> {
    let value = unsafe { CFDictionaryGetValue(properties.0, key) };
    if value.is_null() {
        return None;
    }
    let mut out: i64 = 0;
    let ok = unsafe { CFNumberGetValue(value, CF_NUMBER_SINT64, (&mut out as *mut i64).cast()) };
    ok.then_some(out)
}

// 長い辺がPREVIEW_EDGEを超える画像だけを縮小し、そのほかは元のバイト列のまま返す
pub fn preview(file: File) -> Result<Vec<u8>> {
    thumbnail(file, false)
}
// カード用の画像はImageIOで幅480px以下に縮め、透過を残したPNGをWebPへ変換する。
pub fn link_card(file: File) -> Result<Vec<u8>> {
    let png = thumbnail(file, true)?;
    let image = image::load_from_memory(&png).map_err(|_| failed())?;
    let mut output = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::WebP)
        .map_err(|_| failed())?;
    Ok(output.into_inner())
}
fn thumbnail(file: File, card: bool) -> Result<Vec<u8>> {
    // 待っている間の書き換えも考慮し、実際にImageIOが読むサイズと形式・寸法を確かめる
    if file.metadata()?.len() > IMAGE_LIMIT as u64 {
        return Err(Error::new("LIMIT", "ファイルサイズが上限を超えています。"));
    }
    // 検証済みのファイル記述子を使い、元画像をVecとCFDataへ丸ごとコピーしない
    let path = format!("/dev/fd/{}", file.as_raw_fd());
    let url = owned(unsafe {
        CFURLCreateFromFileSystemRepresentation(
            ptr::null(),
            path.as_ptr(),
            path.len() as isize,
            false,
        )
    })?;
    let source = owned(unsafe { CGImageSourceCreateWithURL(url.0, ptr::null()) })?;
    let source_type = unsafe { CGImageSourceGetType(source.0) };
    if source_type.is_null() {
        return Err(failed());
    }
    let mut supported = false;
    for format in [
        "public.png",
        "public.jpeg",
        "com.compuserve.gif",
        "org.webmproject.webp",
    ] {
        let format = string(format)?;
        supported |= unsafe { CFEqual(source_type, format.0) };
    }
    if !supported {
        return Err(Error::new("UNSUPPORTED", "非対応の画像形式です。"));
    }
    // 2枚以上のフレームがあるアニメーションは、1枚にすると動かなくなるため元のまま返す
    if !card && unsafe { CGImageSourceGetCount(source.0) } > 1 {
        return Ok(read_image_file(file)?.data);
    }
    let properties =
        owned(unsafe { CGImageSourceCopyPropertiesAtIndex(source.0, 0, ptr::null()) })?;
    let (width_key, height_key) =
        unsafe { (kCGImagePropertyPixelWidth, kCGImagePropertyPixelHeight) };
    let (Some(width), Some(height)) = (
        property(&properties, width_key),
        property(&properties, height_key),
    ) else {
        return Err(failed());
    };
    if width <= 0
        || height <= 0
        || width
            .checked_mul(height)
            .is_none_or(|pixels| pixels > PIXEL_LIMIT as i64)
    {
        return Err(Error::new("LIMIT", "画像の上限は1,600万画素です。"));
    }
    if !card && width.max(height) <= i64::from(PREVIEW_EDGE) {
        return Ok(read_image_file(file)?.data);
    }

    // EXIFの向きを反映し、長い辺をPREVIEW_EDGEにした画像を作る。展開は縮小した大きさだけ
    let edge = if card {
        // 長い辺の寸法に読み替えて、縦長の画像でも幅を480pxにする。拡大はしない。
        if width <= 480 {
            width.max(height)
        } else {
            (480 * width.max(height) + width - 1) / width
        }
    } else {
        i64::from(PREVIEW_EDGE)
    };
    let max_size = number(CF_NUMBER_SINT32, &(edge as i32))?;
    let thumbnail_options = dictionary(unsafe {
        &[
            (kCGImageSourceCreateThumbnailFromImageAlways, kCFBooleanTrue),
            (kCGImageSourceThumbnailMaxPixelSize, max_size.0),
            (
                kCGImageSourceCreateThumbnailWithTransform,
                if card {
                    kCFBooleanFalse
                } else {
                    kCFBooleanTrue
                },
            ),
            (kCGImageSourceShouldCacheImmediately, kCFBooleanFalse),
        ]
    })?;
    let thumbnail =
        owned(unsafe { CGImageSourceCreateThumbnailAtIndex(source.0, 0, thumbnail_options.0) })?;

    // 透過のない画像はJPEG、透過のある画像は透過を残すためPNGにする。
    // CGImageAlphaInfoのうち、アルファ成分を持つ値は1から4と7(Onlyのみ)
    let has_alpha = matches!(unsafe { CGImageGetAlphaInfo(thumbnail.0) }, 1..=4 | 7);
    let (uti, encode_options) = if has_alpha || card {
        ("public.png", None)
    } else {
        let quality = number(CF_NUMBER_FLOAT64, &0.8_f64)?;
        let options =
            dictionary(unsafe { &[(kCGImageDestinationLossyCompressionQuality, quality.0)] })?;
        ("public.jpeg", Some(options))
    };
    let uti = string(uti)?;
    let out = owned(unsafe { CFDataCreateMutable(ptr::null(), 0) })?;
    let destination =
        owned(unsafe { CGImageDestinationCreateWithData(out.0, uti.0, 1, ptr::null()) })?;
    let encode_options = encode_options
        .as_ref()
        .map_or(ptr::null(), |options| options.0);
    unsafe { CGImageDestinationAddImage(destination.0, thumbnail.0, encode_options) };
    if !unsafe { CGImageDestinationFinalize(destination.0) } {
        return Err(failed());
    }
    let length = unsafe { CFDataGetLength(out.0) } as usize;
    if length == 0 {
        return Err(failed());
    }
    let encoded = unsafe { std::slice::from_raw_parts(CFDataGetBytePtr(out.0), length) };
    Ok(encoded.to_vec())
}
