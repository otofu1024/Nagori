use super::*;

fn candidate(label: &str, root: Option<&str>, idle: bool) -> Candidate {
    Candidate {
        label: label.into(),
        root: root.map(str::to_owned),
        idle,
    }
}

#[test]
fn open_request_focuses_the_window_that_already_has_the_folder() {
    // 同じフォルダを開いていれば、空の窓があっても前に出す
    let candidates = [
        candidate("main", Some("/a"), false),
        candidate("window-000001", Some("/b"), false),
        candidate("window-000002", None, true),
    ];
    assert_eq!(
        route(&candidates, "/b"),
        Route::Focus("window-000001".into())
    );
}

#[test]
fn open_request_reuses_the_first_idle_window_when_no_window_has_the_folder() {
    let candidates = [
        candidate("main", Some("/a"), false),
        candidate("window-000001", None, false),
        candidate("window-000002", None, true),
    ];
    assert_eq!(
        route(&candidates, "/c"),
        Route::Reuse("window-000002".into())
    );
}

#[test]
fn open_request_creates_a_window_when_nothing_matches_or_is_idle() {
    let candidates = [
        candidate("main", Some("/a"), false),
        candidate("window-000001", None, false),
    ];
    assert_eq!(route(&candidates, "/c"), Route::Create);
    assert_eq!(route(&[], "/c"), Route::Create);
}
