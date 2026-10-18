use super::*;
use serde_json::{Map, Value};

#[test]
fn settings_defaults_and_resolved_theme_roundtrip() {
    let defaults = Settings::default();
    assert_eq!(defaults.theme, "system");
    assert_eq!(defaults.font_size, 19);
    for theme in ["light", "dark"] {
        let settings = Settings {
            theme: theme.into(),
            last_project: Some("/fixture/project".into()),
            last_file: Some("posts/note.md".into()),
            recent_files: BTreeMap::from([(
                "/fixture/project".to_owned(),
                vec!["posts/note.md".to_owned(), "other.md".to_owned()],
            )]),
            font_size: 17,
            ..defaults.clone()
        };
        settings.validate().unwrap();
        let stored = serde_json::to_vec(&settings).unwrap();
        let restored: Settings = serde_json::from_slice(&stored).unwrap();
        assert_eq!(restored.theme, theme);
        assert_eq!(restored.font_size, 17);
        assert_eq!(restored.last_project, settings.last_project);
        assert_eq!(restored.last_file, settings.last_file);
        assert_eq!(restored.recent_files, settings.recent_files);
    }
    let old: Settings = serde_json::from_str(r#"{"theme":"system","fontSize":17}"#).unwrap();
    old.validate().unwrap();
    assert_eq!(old.font_size, 17);
    assert_eq!(old.sidebar_width, 272);
    assert_eq!(old.outline_width, 220);
    // 以前の版が書いた未知の項目は無視して読み込める
    let legacy: Settings =
        serde_json::from_str(r#"{"theme":"dark","appearanceVersion":1}"#).unwrap();
    assert_eq!(legacy.theme, "dark");
}

#[test]
fn settings_writing_modes_default_roundtrip_and_type_check() {
    let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
    assert!(!old.focus_mode && !old.typewriter_mode);
    for focus in [true, false] {
        for typewriter in [true, false] {
            let settings: Settings = serde_json::from_str(&format!(
                r#"{{"focusMode":{focus},"typewriterMode":{typewriter}}}"#
            ))
            .unwrap();
            settings.validate().unwrap();
            let restored: Settings =
                serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
            assert_eq!(restored.focus_mode, focus);
            assert_eq!(restored.typewriter_mode, typewriter);
        }
    }
    for key in ["focusMode", "typewriterMode"] {
        for value in ["null", "0", "1", r#""false""#, "[]", "{}"] {
            assert!(serde_json::from_str::<Settings>(&format!(r#"{{"{key}":{value}}}"#)).is_err());
        }
    }
}

#[test]
fn settings_outline_visibility_defaults_roundtrip_and_type_check() {
    assert!(Settings::default().outline_visible);
    let old: Settings = serde_json::from_str(r#"{"theme":"dark","fontSize":17}"#).unwrap();
    assert!(old.outline_visible);
    assert_eq!(old.theme, "dark");
    assert_eq!(old.font_size, 17);
    for visible in [true, false] {
        let settings: Settings =
            serde_json::from_str(&format!(r#"{{"outlineVisible":{visible}}}"#)).unwrap();
        settings.validate().unwrap();
        assert_eq!(settings.outline_visible, visible);
        let stored = serde_json::to_vec(&settings).unwrap();
        let restored: Settings = serde_json::from_slice(&stored).unwrap();
        assert_eq!(restored.outline_visible, visible);
    }
    for value in ["null", "0", "1", r#""false""#, "[]", "{}"] {
        assert!(
            serde_json::from_str::<Settings>(&format!(r#"{{"outlineVisible":{value}}}"#)).is_err()
        );
    }
}

#[test]
fn settings_pane_widths_validate_on_read_and_write() {
    for (sidebar, outline) in [(200, 180), (272, 220), (420, 360)] {
        let stored = format!(r#"{{"sidebarWidth":{sidebar},"outlineWidth":{outline}}}"#);
        let settings: Settings = serde_json::from_str(&stored).unwrap();
        settings.validate().unwrap();
        assert_eq!(settings.sidebar_width, sidebar);
        assert_eq!(settings.outline_width, outline);
        let restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(restored.sidebar_width, sidebar);
        assert_eq!(restored.outline_width, outline);
    }
    for value in [-1, 0, 179, 421, 65536] {
        let settings: Settings = serde_json::from_str(&format!(
            r#"{{"sidebarWidth":{value},"outlineWidth":{value},"theme":"dark","fontSize":17}}"#
        ))
        .unwrap();
        assert_eq!(settings.sidebar_width, 272);
        assert_eq!(settings.outline_width, 220);
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.font_size, 17);
    }
    for (sidebar, outline) in [(199, 179), (421, 361)] {
        let settings = Settings {
            sidebar_width: sidebar,
            outline_width: outline,
            ..Settings::default()
        };
        let restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(restored.sidebar_width, 272);
        assert_eq!(restored.outline_width, 220);
    }
}

#[test]
fn settings_starred_defaults_roundtrip_and_validate() {
    let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
    assert!(old.starred.is_empty());
    old.validate().unwrap();
    let stored: Settings = serde_json::from_str(
        r#"{"starred":{"/Users/me/notes":["a.md","posts/b.md"],"/Users/me/other":[]}}"#,
    )
    .unwrap();
    stored.validate().unwrap();
    let restored: Settings = serde_json::from_slice(&serde_json::to_vec(&stored).unwrap()).unwrap();
    assert_eq!(restored.starred, stored.starred);
    assert_eq!(restored.starred["/Users/me/notes"], ["a.md", "posts/b.md"]);
    // 型が違う、または件数や空の値が上限を超える設定は拒否する
    for value in [r#""a.md""#, "[]", r#"{"/x":"a.md"}"#, r#"{"/x":[1]}"#] {
        assert!(serde_json::from_str::<Settings>(&format!(r#"{{"starred":{value}}}"#)).is_err());
    }
    let many_paths = Settings {
        starred: BTreeMap::from([("/x".to_owned(), vec!["a.md".to_owned(); 1001])]),
        ..Settings::default()
    };
    assert!(many_paths.validate().is_err());
    let many_roots = Settings {
        starred: (0..101).map(|i| (format!("/root/{i}"), vec![])).collect(),
        ..Settings::default()
    };
    assert!(many_roots.validate().is_err());
    let empty_path = Settings {
        starred: BTreeMap::from([("/x".to_owned(), vec![String::new()])]),
        ..Settings::default()
    };
    assert!(empty_path.validate().is_err());
}

#[test]
fn settings_panel_fields_default_and_read_back_in_range() {
    let defaults = Settings::default();
    assert_eq!(defaults.editor_width, 720);
    assert_eq!(defaults.line_height, 1.9);
    assert_eq!(defaults.font_family, "sans");
    assert_eq!(defaults.autosave_delay, 500);
    assert!(!defaults.start_in_preview);
    assert!(defaults.heading_rule);
    assert_eq!(defaults.recent_edited_count, 30);
    assert_eq!(defaults.trash_retention_days, Some(30));
    assert!(!defaults.zoom_font_size);
    assert!(!defaults.auto_editor_width);
    assert!(defaults.recent_opened_at.is_empty());
    // 項目のない古い設定は初期値で読む
    let old: Settings = serde_json::from_str(r#"{"theme":"dark","fontSize":17}"#).unwrap();
    assert_eq!(old.editor_width, 720);
    assert_eq!(old.trash_retention_days, Some(30));
    assert!(!old.zoom_font_size);
    assert!(!old.auto_editor_width);
    assert!(old.heading_rule && !old.start_in_preview);
    assert!(old.recent_opened_at.is_empty());
    // 範囲内の値は保存して読み直しても同じ
    let stored = r#"{"editorWidth":900,"lineHeight":2.2,"fontFamily":"serif","autosaveDelay":1200,"startInPreview":true,"headingRule":false,"recentEditedCount":45,"trashRetentionDays":90,"recentOpenedAt":{"/work":{"posts/a.md":1700000000000}}}"#;
    let settings: Settings = serde_json::from_str(stored).unwrap();
    settings.validate().unwrap();
    assert_eq!(settings.editor_width, 900);
    assert_eq!(settings.line_height, 2.2);
    assert_eq!(settings.font_family, "serif");
    assert_eq!(settings.autosave_delay, 1200);
    assert!(settings.start_in_preview && !settings.heading_rule);
    assert_eq!(settings.recent_edited_count, 45);
    assert_eq!(settings.trash_retention_days, Some(90));
    assert_eq!(
        settings.recent_opened_at["/work"]["posts/a.md"],
        1700000000000
    );
    let restored: Settings =
        serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
    assert_eq!(restored.editor_width, 900);
    assert_eq!(restored.line_height, 2.2);
    assert_eq!(restored.font_family, "serif");
    assert_eq!(restored.trash_retention_days, Some(90));
    assert_eq!(restored.recent_opened_at, settings.recent_opened_at);
    let zoom: Settings = serde_json::from_str(r#"{"zoomFontSize":true}"#).unwrap();
    assert!(zoom.zoom_font_size);
    let saved = serde_json::to_value(&zoom).unwrap();
    assert_eq!(saved["zoomFontSize"], true);
    let auto: Settings =
        serde_json::from_str(r#"{"autoEditorWidth":true,"editorWidth":900}"#).unwrap();
    assert!(auto.auto_editor_width);
    assert_eq!(auto.editor_width, 900);
    assert_eq!(
        serde_json::to_value(&auto).unwrap()["autoEditorWidth"],
        true
    );
    // 範囲の両端は受け付ける
    for (width, height, delay, edited) in [(560, 1.4, 300, 10), (1000, 2.4, 5000, 50)] {
        let settings: Settings = serde_json::from_str(&format!(
            r#"{{"editorWidth":{width},"lineHeight":{height},"autosaveDelay":{delay},"recentEditedCount":{edited}}}"#
        ))
        .unwrap();
        assert_eq!(settings.editor_width, width);
        assert_eq!(settings.line_height, height);
        assert_eq!(settings.autosave_delay, delay);
        assert_eq!(settings.recent_edited_count, edited);
    }
    // 範囲外の数値は初期値へ戻す
    for (key, value, initial) in [
        ("editorWidth", "559", 720.0),
        ("editorWidth", "1001", 720.0),
        ("lineHeight", "1.39", 1.9),
        ("lineHeight", "2.41", 1.9),
        ("autosaveDelay", "299", 500.0),
        ("autosaveDelay", "5001", 500.0),
        ("recentEditedCount", "9", 30.0),
        ("recentEditedCount", "51", 30.0),
    ] {
        let settings: Settings = serde_json::from_str(&format!(r#"{{"{key}":{value}}}"#)).unwrap();
        let actual = match key {
            "editorWidth" => settings.editor_width as f64,
            "lineHeight" => settings.line_height,
            "autosaveDelay" => settings.autosave_delay as f64,
            _ => settings.recent_edited_count as f64,
        };
        assert_eq!(actual, initial, "{key}={value}");
    }
    // 字体はsansとserif 以外をsans へ戻す
    let settings: Settings = serde_json::from_str(r#"{"fontFamily":"mono"}"#).unwrap();
    assert_eq!(settings.font_family, "sans");
    // 保存期限は null（無期限）と選べる日数を残し、それ以外は30日へ戻す
    for days in [7, 14, 30, 60, 90] {
        let settings: Settings =
            serde_json::from_str(&format!(r#"{{"trashRetentionDays":{days}}}"#)).unwrap();
        assert_eq!(settings.trash_retention_days, Some(days));
    }
    let forever: Settings = serde_json::from_str(r#"{"trashRetentionDays":null}"#).unwrap();
    assert_eq!(forever.trash_retention_days, None);
    for days in ["0", "1", "45", "365", "-7", "7.5"] {
        let settings: Settings =
            serde_json::from_str(&format!(r#"{{"trashRetentionDays":{days}}}"#)).unwrap();
        assert_eq!(settings.trash_retention_days, Some(30), "{days}");
    }
    // 型が違う値は読み込みを失敗させる
    for (key, value) in [
        ("startInPreview", "1"),
        ("headingRule", r#""true""#),
        ("editorWidth", "null"),
    ] {
        assert!(serde_json::from_str::<Settings>(&format!(r#"{{"{key}":{value}}}"#)).is_err());
    }
}

#[test]
fn recent_opened_times_drop_bad_entries_and_keep_the_newest_200() {
    // 時刻が数でない項目は捨て、残りはそのまま読む
    let settings: Settings = serde_json::from_str(
        r#"{"recentOpenedAt":{"/work":{"a.md":1000,"b.md":"2026","c.md":null,"d.md":-5,"e.md":2000.0}}}"#,
    )
    .unwrap();
    assert_eq!(
        settings.recent_opened_at["/work"],
        BTreeMap::from([("a.md".to_owned(), 1000), ("e.md".to_owned(), 2000)])
    );
    // 上限はワークスペースのルートごとに当てる。上限を超えたら、古いものから捨てる
    let entries: Vec<String> = (0..205)
        .map(|i| format!(r#""n{i:03}.md":{}"#, 1_000 + i))
        .collect();
    let settings: Settings = serde_json::from_str(&format!(
        r#"{{"recentOpenedAt":{{"/work":{{{0}}},"/other":{{"x.md":1}}}}}}"#,
        entries.join(",")
    ))
    .unwrap();
    assert_eq!(settings.recent_opened_at["/work"].len(), 200);
    assert!(!settings.recent_opened_at["/work"].contains_key("n000.md"));
    assert!(!settings.recent_opened_at["/work"].contains_key("n004.md"));
    assert_eq!(settings.recent_opened_at["/work"]["n005.md"], 1_005);
    assert_eq!(settings.recent_opened_at["/work"]["n204.md"], 1_204);
    assert_eq!(settings.recent_opened_at["/other"]["x.md"], 1);
    // 配列など、対応しない型は読み込みを失敗させる
    assert!(serde_json::from_str::<Settings>(r#"{"recentOpenedAt":[]}"#).is_err());
}

#[test]
fn blog_features_default_on_and_persist_off() {
    let settings: Settings = serde_json::from_str("{}").unwrap();
    assert!(settings.blog_features);
    let settings: Settings = serde_json::from_str(r#"{"blogFeatures":false}"#).unwrap();
    assert!(!settings.blog_features);
    assert_eq!(
        serde_json::to_value(settings).unwrap()["blogFeatures"],
        false
    );
}

#[test]
fn blog_display_flags_default_on_and_persist_independently() {
    let legacy: Settings = serde_json::from_str(r#"{"blogFeatures":false}"#).unwrap();
    assert!(legacy.blog_article_header);
    assert!(legacy.blog_link_cards_enabled);
    assert!(legacy.blog_characters_enabled);
    assert!(legacy.blog_body_theme);
    assert!(legacy.blog_indent_on_enter);
    let keys = [
        "blogArticleHeader",
        "blogLinkCardsEnabled",
        "blogCharactersEnabled",
        "blogBodyTheme",
        "blogIndentOnEnter",
    ];
    for key in keys {
        let settings: Settings =
            serde_json::from_str(&format!(r#"{{"blogFeatures":false,"{key}":false}}"#)).unwrap();
        let saved = serde_json::to_value(&settings).unwrap();
        assert_eq!(saved[key], false);
        assert_eq!(saved["blogFeatures"], false);
        for other in keys {
            assert_eq!(saved[other], other != key);
        }
        let restored: Settings = serde_json::from_value(saved.clone()).unwrap();
        assert_eq!(serde_json::to_value(restored).unwrap(), saved);
    }
}

#[test]
fn open_windows_restore_list_falls_back_to_the_last_project_before_migration() {
    let legacy: Settings =
        serde_json::from_str(r#"{"lastProject":"/work","lastFile":"a.md"}"#).unwrap();
    assert_eq!(
        legacy.restored_windows(),
        vec![OpenWindow {
            project: "/work".into(),
            file: Some("a.md".into()),
        }]
    );
    let fresh: Settings = serde_json::from_str("{}").unwrap();
    assert!(fresh.restored_windows().is_empty());
    let saved: Settings = serde_json::from_str(
        r#"{"lastProject":"/old","openWindows":[{"project":"/a","file":null},{"project":"/b","file":"x/y.md"}]}"#,
    )
    .unwrap();
    assert_eq!(
        saved.restored_windows(),
        vec![
            OpenWindow {
                project: "/a".into(),
                file: None,
            },
            OpenWindow {
                project: "/b".into(),
                file: Some("x/y.md".into()),
            },
        ]
    );
    // 開いていたウィンドウが0枚で終了した時は、古い lastProject を開き直さない
    let emptied: Settings =
        serde_json::from_str(r#"{"lastProject":"/old","openWindows":[]}"#).unwrap();
    assert!(emptied.restored_windows().is_empty());
    let stored = serde_json::to_value(&saved).unwrap();
    assert_eq!(stored["openWindows"][1]["file"], "x/y.md");
    let restored: Settings = serde_json::from_value(stored).unwrap();
    assert_eq!(restored.restored_windows(), saved.restored_windows());
}

#[test]
fn a_patch_keeps_the_changes_other_windows_saved() {
    // 別のウィンドウが保存した theme を、このウィンドウが送らなかった項目で消さない
    let current = serde_json::to_value(Settings {
        theme: "dark".into(),
        ..Settings::default()
    })
    .unwrap();
    let patch = serde_json::json!({ "fontSize": 21 })
        .as_object()
        .unwrap()
        .clone();
    let merged = merge(current.clone(), patch).unwrap();
    assert_eq!(merged.theme, "dark");
    assert_eq!(merged.font_size, 21);
    // 範囲外の値は保存させず、読み込みと同じ規則で直す
    let line = serde_json::json!({ "lineHeight": 9.0 })
        .as_object()
        .unwrap()
        .clone();
    assert_eq!(merge(current.clone(), line).unwrap().line_height, 1.9);
    let invalid = serde_json::json!({ "theme": "blue" })
        .as_object()
        .unwrap()
        .clone();
    assert!(merge(current, invalid).is_err());
}

fn with_root_keys(recent: &[(&str, &[&str])], opened: &[(&str, &[(&str, u64)])]) -> Value {
    let files: Map<String, Value> = recent
        .iter()
        .map(|(root, paths)| ((*root).to_owned(), serde_json::json!(paths)))
        .collect();
    let times: Map<String, Value> = opened
        .iter()
        .map(|(root, entries)| {
            let map: Map<String, Value> = entries
                .iter()
                .map(|(path, time)| ((*path).to_owned(), serde_json::json!(time)))
                .collect();
            ((*root).to_owned(), Value::Object(map))
        })
        .collect();
    serde_json::json!({ "recentFiles": files, "recentOpenedAt": times })
}

#[test]
fn legacy_recent_lists_move_to_the_last_project_and_are_dropped_without_one() {
    // 移行前の最近見たノートは、lastProjectがあればそのルートの記録になる
    let legacy: Settings = from_stored(serde_json::json!({
        "lastProject": "/work",
        "recentFiles": ["a.md", "b/c.md"],
        "recentOpenedAt": { "a.md": 1700000000000u64 },
    }))
    .unwrap();
    assert_eq!(
        legacy.recent_files,
        BTreeMap::from([(
            "/work".to_owned(),
            vec!["a.md".to_owned(), "b/c.md".to_owned()]
        )])
    );
    assert_eq!(
        legacy.recent_opened_at,
        BTreeMap::from([(
            "/work".to_owned(),
            BTreeMap::from([("a.md".to_owned(), 1700000000000)]),
        )])
    );
    // lastProjectがなければ、どのフォルダの記録か分からないので捨てる
    let orphan = from_stored(serde_json::json!({
        "recentFiles": ["a.md"],
        "recentOpenedAt": { "a.md": 1 },
    }))
    .unwrap();
    assert!(orphan.recent_files.is_empty());
    assert!(orphan.recent_opened_at.is_empty());
    // 新しい形で保存されたものは、そのまま読む
    let stored = from_stored(serde_json::json!({
        "lastProject": "/work",
        "recentFiles": { "/a": ["x.md"] },
        "recentOpenedAt": { "/a": { "x.md": 5 } },
    }))
    .unwrap();
    assert_eq!(stored.recent_files["/a"], ["x.md"]);
    assert_eq!(stored.recent_opened_at["/a"]["x.md"], 5);
    assert!(!stored.recent_files.contains_key("/work"));
}

#[test]
fn a_patch_for_one_root_keeps_the_records_of_another_root() {
    // 2つのフォルダの記録が混ざらず、片方を書き換えても、もう片方は残る
    let current = with_root_keys(
        &[("/a", &["one.md"]), ("/b", &["two.md"])],
        &[("/a", &[("one.md", 10)]), ("/b", &[("two.md", 20)])],
    );
    let patch = serde_json::json!({
        "recentFiles": { "/a": ["three.md"] },
    })
    .as_object()
    .unwrap()
    .clone();
    let merged = merge(current, patch).unwrap();
    assert_eq!(merged.recent_files["/a"], ["three.md"]);
    assert_eq!(merged.recent_files["/b"], ["two.md"]);
    assert_eq!(merged.recent_opened_at["/a"]["one.md"], 10);
    assert_eq!(merged.recent_opened_at["/b"]["two.md"], 20);
}

#[test]
fn saves_from_two_windows_on_different_roots_do_not_erase_each_other() {
    // 同じ時点の設定を見た2つのウィンドウが、別のフォルダの記録を続けて保存しても、互いの変更を消さない
    let base = serde_json::to_value(Settings::default()).unwrap();
    let window_a = serde_json::json!({
        "starred": { "/a": ["a.md"] },
        "recentFiles": { "/a": ["a.md"] },
    })
    .as_object()
    .unwrap()
    .clone();
    let window_b = serde_json::json!({
        "starred": { "/b": ["b.md"] },
        "recentOpenedAt": { "/b": { "b.md": 7 } },
    })
    .as_object()
    .unwrap()
    .clone();
    let after_a = merge(base, window_a).unwrap();
    let after_b = merge(serde_json::to_value(&after_a).unwrap(), window_b).unwrap();
    assert_eq!(after_b.starred["/a"], ["a.md"]);
    assert_eq!(after_b.starred["/b"], ["b.md"]);
    assert_eq!(after_b.recent_files["/a"], ["a.md"]);
    assert_eq!(after_b.recent_opened_at["/b"]["b.md"], 7);
    // 外したルートはnullで消え、ほかのルートは残る
    let removed = merge(
        serde_json::to_value(&after_b).unwrap(),
        serde_json::json!({ "starred": { "/a": null } })
            .as_object()
            .unwrap()
            .clone(),
    )
    .unwrap();
    assert!(!removed.starred.contains_key("/a"));
    assert_eq!(removed.starred["/b"], ["b.md"]);
    assert_eq!(removed.recent_files["/a"], ["a.md"]);
}

#[test]
fn broadcast_sends_the_saved_value_of_each_sent_root_and_null_for_removed_ones() {
    // 別のウィンドウには、送ったルートの保存後の値だけを送る。外したルートはnullにする
    let stored = serde_json::json!({
        "starred": { "/a": ["a.md"], "/other": ["x.md"] },
        "theme": "dark",
    });
    let sent = serde_json::json!({
        "starred": { "/a": ["a.md"], "/gone": null },
        "theme": "dark",
    })
    .as_object()
    .unwrap()
    .clone();
    let values = broadcast_values(&stored, &sent);
    assert_eq!(
        values["starred"],
        serde_json::json!({ "/a": ["a.md"], "/gone": null })
    );
    assert_eq!(values["theme"], "dark");
}

#[test]
fn a_legacy_recent_list_in_the_stored_file_is_migrated_on_a_patch() {
    // 古いファイルに送られた保存でも、移行してから重ねる
    let current = serde_json::json!({
        "lastProject": "/work",
        "recentFiles": ["a.md"],
        "fontSize": 19,
    });
    let merged = merge(
        current,
        serde_json::json!({ "fontSize": 20 })
            .as_object()
            .unwrap()
            .clone(),
    )
    .unwrap();
    assert_eq!(merged.font_size, 20);
    assert_eq!(merged.recent_files["/work"], ["a.md"]);
}

// 使ったフォルダが count 個ある記録を作る。番号が大きいルートほど新しい時刻を持つ
fn many_roots(count: usize) -> Value {
    let roots: Vec<String> = (0..count).map(|i| format!("/root/{i:02}")).collect();
    let files: Map<String, Value> = roots
        .iter()
        .map(|root| (root.clone(), serde_json::json!(["a.md"])))
        .collect();
    let times: Map<String, Value> = roots
        .iter()
        .enumerate()
        .map(|(i, root)| {
            (
                root.clone(),
                serde_json::json!({ "a.md": 1_000 + i as u64 }),
            )
        })
        .collect();
    serde_json::json!({ "recentFiles": files, "recentOpenedAt": times })
}

#[test]
fn recent_roots_over_the_limit_are_dropped_oldest_first_on_read() {
    // 25個のフォルダの記録があっても読み込みは失敗せず、古い5個のルートが捨てられる
    let bytes = serde_json::to_vec(&many_roots(25)).unwrap();
    let settings = parse_stored(&bytes).unwrap();
    assert_eq!(settings.recent_files.len(), RECENT_ROOT_LIMIT);
    assert_eq!(settings.recent_opened_at.len(), RECENT_ROOT_LIMIT);
    for i in 0..5 {
        let root = format!("/root/{i:02}");
        assert!(!settings.recent_files.contains_key(&root));
        assert!(!settings.recent_opened_at.contains_key(&root));
    }
    assert_eq!(settings.recent_files["/root/05"], ["a.md"]);
    assert_eq!(settings.recent_opened_at["/root/24"]["a.md"], 1_024);
}

#[test]
fn a_patch_keeps_the_root_it_sends_even_when_it_is_the_oldest() {
    // 上限いっぱいの記録に、最も古い時刻のルートを送っても、送ったルートは残る。代わりに古いほかのルートが捨てられる
    let patch = serde_json::json!({
        "recentFiles": { "/root/new": ["n.md"] },
        "recentOpenedAt": { "/root/new": { "n.md": 1 } },
    })
    .as_object()
    .unwrap()
    .clone();
    let merged = merge(many_roots(20), patch).unwrap();
    assert_eq!(merged.recent_files.len(), RECENT_ROOT_LIMIT);
    assert_eq!(merged.recent_opened_at.len(), RECENT_ROOT_LIMIT);
    assert_eq!(merged.recent_files["/root/new"], ["n.md"]);
    assert_eq!(merged.recent_opened_at["/root/new"]["n.md"], 1);
    assert!(!merged.recent_files.contains_key("/root/00"));
    assert!(!merged.recent_opened_at.contains_key("/root/00"));
    assert_eq!(merged.recent_files["/root/01"], ["a.md"]);
    // 保存したものは、上限内の大きさで、読み直しても同じ
    let saved = encode(&merged).unwrap();
    let restored = parse_stored(&saved).unwrap();
    assert_eq!(restored.recent_files, merged.recent_files);
    assert_eq!(restored.recent_opened_at, merged.recent_opened_at);
}

#[test]
fn starred_roots_are_never_dropped_by_the_recent_root_limit() {
    // スターはユーザーが付けた印なので、最近使ったフォルダの上限で捨てない
    let mut value = many_roots(25);
    value["starred"] = Value::Object(
        (0..25)
            .map(|i| (format!("/root/{i:02}"), serde_json::json!(["s.md"])))
            .collect(),
    );
    let settings = parse_stored(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(settings.recent_files.len(), RECENT_ROOT_LIMIT);
    assert_eq!(settings.starred.len(), 25);
    assert_eq!(settings.starred["/root/00"], ["s.md"]);
}

#[test]
fn twenty_roots_with_200_opened_times_read_and_save_within_the_limit() {
    // 1ルート200件の時刻と100件のノートを20ルート分持っても、読み書きでき、保存の上限に収まる
    let opened: Map<String, Value> = (0..20)
        .map(|r| {
            let entries: Map<String, Value> = (0..200u64)
                .map(|i| {
                    (
                        format!("posts/2026/note-{r:02}-{i:03}-title.md"),
                        serde_json::json!(1_700_000_000_000u64 + i),
                    )
                })
                .collect();
            (
                format!("/Users/me/workspaces/project-{r:02}"),
                Value::Object(entries),
            )
        })
        .collect();
    let files: Map<String, Value> = opened
        .keys()
        .map(|root| {
            let paths: Vec<String> = (0..100)
                .map(|i| format!("posts/2026/note-{i:03}.md"))
                .collect();
            (root.clone(), serde_json::json!(paths))
        })
        .collect();
    let value = serde_json::json!({ "recentFiles": files, "recentOpenedAt": opened });
    let settings = parse_stored(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(settings.recent_opened_at.len(), 20);
    assert!(settings
        .recent_opened_at
        .values()
        .all(|entries| entries.len() == 200));
    let saved = encode(&settings).unwrap();
    assert!(saved.len() <= SETTINGS_LIMIT);
    let restored = parse_stored(&saved).unwrap();
    assert_eq!(restored.recent_opened_at, settings.recent_opened_at);
    assert_eq!(restored.recent_files, settings.recent_files);
}

#[test]
fn a_save_over_the_size_limit_is_refused() {
    // 上限を超える大きさは保存しない。上限の検査は保存と同じ値を使う
    let settings = Settings {
        starred: BTreeMap::from([("/x".to_owned(), vec!["a".repeat(1500); 1000])]),
        ..Settings::default()
    };
    assert!(encode(&settings).is_err());
}
