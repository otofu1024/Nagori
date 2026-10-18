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

fn project(root: &str, file: Option<&str>) -> Project {
    Project {
        root: root.into(),
        file: file.map(str::to_owned),
    }
}

#[test]
fn last_window_keeps_its_folder_and_file_after_it_closes() {
    // 最後の1枚が閉じた時、窓の一覧にその窓が残っていなくても、その窓の記録は作れる
    let projects = HashMap::from([("main".to_owned(), project("/a", Some("note.md")))]);
    assert_eq!(
        window_record(&projects, "main"),
        Some(OpenWindow {
            project: "/a".into(),
            file: Some("note.md".into()),
        })
    );
    assert_eq!(
        window_records(&projects, &[]),
        Vec::<OpenWindow>::new(),
        "一覧に残らない窓は、一覧から記録しない"
    );
}

#[test]
fn window_without_a_folder_is_not_recorded() {
    let projects = HashMap::from([("window-000001".to_owned(), project("/b", None))]);
    assert_eq!(window_record(&projects, "main"), None);
    assert_eq!(
        window_records(&projects, &["window-000001".into(), "main".into()]),
        vec![OpenWindow {
            project: "/b".into(),
            file: None,
        }]
    );
}

#[test]
fn closed_window_that_is_not_last_is_left_out_of_the_records() {
    // 最後でない窓は、閉じる時に状態を捨てるので、開き直しの一覧に残らない
    let mut projects = HashMap::from([
        ("main".to_owned(), project("/a", Some("a.md"))),
        ("window-000001".to_owned(), project("/b", Some("b.md"))),
    ]);
    projects.remove("window-000001");
    let labels = ["main".to_owned(), "window-000001".to_owned()];
    assert_eq!(
        window_records(&projects, &labels),
        vec![OpenWindow {
            project: "/a".into(),
            file: Some("a.md".into()),
        }]
    );
}
