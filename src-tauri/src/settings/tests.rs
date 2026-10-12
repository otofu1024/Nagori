use super::*;

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
            recent_files: vec!["posts/note.md".into(), "other.md".into()],
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
    let stored = r#"{"editorWidth":900,"lineHeight":2.2,"fontFamily":"serif","autosaveDelay":1200,"startInPreview":true,"headingRule":false,"recentEditedCount":45,"trashRetentionDays":90,"recentOpenedAt":{"posts/a.md":1700000000000}}"#;
    let settings: Settings = serde_json::from_str(stored).unwrap();
    settings.validate().unwrap();
    assert_eq!(settings.editor_width, 900);
    assert_eq!(settings.line_height, 2.2);
    assert_eq!(settings.font_family, "serif");
    assert_eq!(settings.autosave_delay, 1200);
    assert!(settings.start_in_preview && !settings.heading_rule);
    assert_eq!(settings.recent_edited_count, 45);
    assert_eq!(settings.trash_retention_days, Some(90));
    assert_eq!(settings.recent_opened_at["posts/a.md"], 1700000000000);
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
        r#"{"recentOpenedAt":{"a.md":1000,"b.md":"2026","c.md":null,"d.md":-5,"e.md":2000.0}}"#,
    )
    .unwrap();
    assert_eq!(
        settings.recent_opened_at,
        BTreeMap::from([("a.md".to_owned(), 1000), ("e.md".to_owned(), 2000)])
    );
    // 上限を超えたら、古いものから捨てる
    let entries: Vec<String> = (0..205)
        .map(|i| format!(r#""n{i:03}.md":{}"#, 1_000 + i))
        .collect();
    let settings: Settings = serde_json::from_str(&format!(
        r#"{{"recentOpenedAt":{{{}}}}}"#,
        entries.join(",")
    ))
    .unwrap();
    assert_eq!(settings.recent_opened_at.len(), 200);
    assert!(!settings.recent_opened_at.contains_key("n000.md"));
    assert!(!settings.recent_opened_at.contains_key("n004.md"));
    assert_eq!(settings.recent_opened_at["n005.md"], 1_005);
    assert_eq!(settings.recent_opened_at["n204.md"], 1_204);
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
