// 確認用のコピーを本番と同じファイル処理と検索で読む。
#[allow(dead_code)]
#[path = "../src/blog_characters.rs"]
mod blog_characters;
#[allow(dead_code)]
#[path = "../src/blog_themes.rs"]
mod blog_themes;
#[allow(dead_code)]
#[path = "../src/files.rs"]
mod files;
#[allow(dead_code)]
#[path = "../src/image.rs"]
mod image;
#[allow(dead_code)]
#[path = "../src/link_cards.rs"]
mod link_cards;
#[allow(dead_code)]
#[path = "../src/search.rs"]
mod search;
#[allow(dead_code)]
#[path = "../src/trash.rs"]
mod trash;
fn character_command(
    root: &std::path::Path,
    base: &std::path::Path,
    input: serde_json::Value,
) -> files::Result<serde_json::Value> {
    let path = input["path"].as_str().unwrap_or("");
    match input["action"].as_str().unwrap_or("") {
        "open" => Ok(serde_json::to_value(files::open(root, "src/config.ts")?).unwrap()),
        "imageBaseline" => Ok(serde_json::to_value(blog_characters::image_baseline(root, path)?).unwrap()),
        "save" => {
            let request = serde_json::from_value(input["request"].clone()).map_err(|error| files::Error::new("INVALID", error.to_string()))?;
            Ok(serde_json::to_value(blog_characters::save(root, base, request)?).unwrap())
        },
        "trash" => Ok(serde_json::to_value(trash::list(base, root)?).unwrap()),
        "documents" => Ok(serde_json::Value::Array(files::index_from(root, files::BLOG_DIRECTORY)?.iter().filter(|entry| entry.kind == "markdown").map(|entry| files::open(root, &entry.path).map(|document| serde_json::json!({ "path": document.path, "text": document.text }))).collect::<files::Result<Vec<_>>>()?)),
        _ => Err(files::Error::new("INVALID", "確認の操作がありません。")),
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::fs::canonicalize(std::env::args().nth(1).ok_or("blog path required")?)?;
    if std::env::args().nth(2).as_deref() == Some("--themes") {
        let base = std::env::args().nth(3).ok_or("history path required")?;
        let input: serde_json::Value = serde_json::from_reader(std::io::stdin())?;
        let baseline = input["baseline"].as_str().unwrap_or("");
        let result = match input["action"].as_str().unwrap_or("") {
            "read" => blog_themes::read(&root, std::path::Path::new(&base))
                .map(|value| serde_json::to_value(value).unwrap()),
            "apply" => blog_themes::apply(
                &root,
                std::path::Path::new(&base),
                input["preset"].as_str().unwrap_or(""),
                baseline,
            )
            .map(|value| serde_json::to_value(value).unwrap()),
            "restore" => blog_themes::restore(
                &root,
                std::path::Path::new(&base),
                input["id"].as_str().unwrap_or(""),
                baseline,
            )
            .map(|value| serde_json::to_value(value).unwrap()),
            "delete" => blog_themes::delete_custom(
                &root,
                std::path::Path::new(&base),
                input["id"].as_str().unwrap_or(""),
            )
            .map(|value| serde_json::to_value(value).unwrap()),
            _ => Err(files::Error::new("INVALID", "確認の操作がありません。")),
        }
        .unwrap_or_else(|error| serde_json::json!({ "error": error }));
        serde_json::to_writer(std::io::stdout(), &result)?;
        return Ok(());
    }
    if std::env::args().nth(2).as_deref() == Some("--characters") {
        let base = std::env::args().nth(3).ok_or("trash path required")?;
        let input = serde_json::from_reader(std::io::stdin())?;
        let result = character_command(&root, std::path::Path::new(&base), input)
            .unwrap_or_else(|error| serde_json::json!({ "error": error }));
        serde_json::to_writer(std::io::stdout(), &result)?;
        return Ok(());
    }
    if std::env::args().nth(2).as_deref() == Some("--theme") {
        serde_json::to_writer(std::io::stdout(), &files::read_blog_theme(&root))?;
        return Ok(());
    }
    if std::env::args().nth(2).as_deref() == Some("--image") {
        use std::io::Write;
        let path = std::env::args().nth(3).ok_or("image path required")?;
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.split('/').any(|part| part == "..")
        {
            return Err("invalid public image".into());
        }
        let path = files::resolve(&root, &format!("public{}", path), false)
            .map_err(|error| error.message)?;
        std::io::stdout().write_all(
            &image::read_image(&path)
                .map_err(|error| error.message)?
                .data,
        )?;
        return Ok(());
    }
    if std::env::args().nth(2).as_deref() == Some("--fetch-card") {
        let url = std::env::args().nth(3).ok_or("URL required")?;
        let preview = link_cards::Fetcher::default()
            .fetch(&root, &url)
            .map_err(|error| error.message)?;
        serde_json::to_writer(std::io::stdout(), &preview)?;
        return Ok(());
    }
    let blog_mode = files::blog_mode(&root, true);
    let directory = if blog_mode { files::BLOG_DIRECTORY } else { "" };
    let entries = files::index_from(&root, directory).map_err(|error| error.message)?;
    let documents = entries
        .iter()
        .filter(|entry| entry.kind == "markdown")
        .map(|entry| {
            let opened = files::open(&root, &entry.path).map_err(|error| error.message)?;
            Ok(serde_json::json!({ "path": opened.path, "text": opened.text }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let generic = files::index(&root).map_err(|error| error.message)?;
    let search =
        search::run_from(&root, directory, "title", false, false).map_err(|error| error.message)?;
    serde_json::to_writer(
        std::io::stdout(),
        &serde_json::json!({
            "root": root, "blogMode": blog_mode, "entries": entries,
            "generic": generic, "documents": documents, "search": search,
            "config": files::read_blog_config(&root),
            "linkCards": link_cards::load(&root),
        }),
    )?;
    Ok(())
}
