// Used by the WKWebView fixtures so they exercise the production extractor.
#[path = "../src/graph.rs"]
mod graph;
use std::io::{self, Read};

#[derive(serde::Deserialize)]
struct Document {
    path: String,
    text: String,
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let documents: Vec<Document> = serde_json::from_str(&input)?;
    let articles: Vec<_> = documents
        .into_iter()
        .map(|doc| graph::extract(doc.path, &doc.text))
        .collect();
    serde_json::to_writer(io::stdout(), &articles)?;
    Ok(())
}
