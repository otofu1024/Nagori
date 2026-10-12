// The browser fixture reads a copy through the production file and search code.
#[allow(dead_code)]
#[path = "../src/files.rs"]
mod files;
#[allow(dead_code)]
#[path = "../src/image.rs"]
mod image;
#[allow(dead_code)]
#[path = "../src/search.rs"]
mod search;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::fs::canonicalize(std::env::args().nth(1).ok_or("blog path required")?)?;
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
        }),
    )?;
    Ok(())
}
