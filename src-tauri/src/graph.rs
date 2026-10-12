use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use serde::Serialize;
use serde_yaml_ng::Value;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
pub struct GraphArticle {
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
}

pub fn extract(path: String, text: &str) -> GraphArticle {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut body = text;
    let mut fields = Value::Null;
    if let Some(rest) = text
        .strip_prefix("---\r\n")
        .or_else(|| text.strip_prefix("---\n"))
    {
        let mut offset = 0;
        for line in rest.split_inclusive('\n') {
            if line.trim_end_matches(['\r', '\n', ' ', '\t']) == "---" {
                fields = serde_yaml_ng::from_str(&rest[..offset]).unwrap_or(Value::Null);
                body = &rest[offset + line.len()..];
                break;
            }
            offset += line.len();
        }
    }
    let string = |key: &str| {
        fields
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned()
    };
    let tags = match fields.get("tags") {
        Some(Value::Sequence(values)) => values.iter().filter_map(Value::as_str).collect(),
        Some(Value::String(value)) => vec![value.as_str()],
        _ => vec![],
    };
    let tags = tags
        .into_iter()
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(str::to_owned)
        .collect();
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    let mut image_depth = 0;
    for event in Parser::new_ext(
        body,
        Options::ENABLE_TABLES
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_MATH
            | Options::ENABLE_WIKILINKS,
    ) {
        match event {
            Event::Start(Tag::Image { .. }) => image_depth += 1,
            Event::End(pulldown_cmark::TagEnd::Image) => image_depth -= 1,
            Event::Start(Tag::Link {
                dest_url,
                link_type,
                ..
            }) if image_depth == 0 => {
                let href = dest_url.as_ref();
                if !href.is_empty() && !href.starts_with('#') && !href.starts_with('/') {
                    // External URLs cannot resolve to workspace articles.
                    if !href
                        .split(['/', '?', '#'])
                        .next()
                        .unwrap_or("")
                        .contains(':')
                    {
                        let link = if matches!(link_type, LinkType::WikiLink { .. }) {
                            format!("[[{href}]]")
                        } else {
                            href.into()
                        };
                        if seen.insert(link.clone()) {
                            links.push(link);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    GraphArticle {
        path,
        title: string("title"),
        tags,
        links,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_yaml_and_markdown_links_without_images_code_or_front_matter() {
        let article = extract("a.md".into(), "\u{feff}---\r\ntitle: >-\r\n  長い\r\n  名前\r\nslug: custom\r\ntags: [共通, 'two words', 42, null]\r\ndescription: '[front](front.md)'\r\n---\r\n[B](<my%20post.md#x>) [B](<my%20post.md#x>) [ref][post] [post]\n\n[post]: ref.md\n\n![image](image.md) ![with [link](inside.md)](image.png) `[code](code.md)`\n\n```md\n[fenced](fenced.md)\n```\n\n    [indented](indented.md)\n\n[external](https://example.com) [anchor](#x) [network](//example.com) $[math](math.md)$");
        assert_eq!(article.title, "長い 名前");
        assert_eq!(article.tags, ["共通", "two words"]);
        assert_eq!(article.links, ["my%20post.md#x", "ref.md"]);
    }

    #[test]
    fn extracts_wiki_links_without_code_images_math_or_external_targets() {
        let article = extract("a.md".into(), "[[Note]] [[Note]] [[folder/Note.md#part|label]] [regular](Note) `[[code]]` ![image](Note.md) ![[image]] $[[math]]$\n\n```md\n[[fenced]]\n```\n\n[[https://example.com]] [[/absolute]] [blog](/posts/slug)");
        assert_eq!(
            article.links,
            ["[[Note]]", "[[folder/Note.md#part]]", "Note"]
        );
    }

    #[test]
    fn invalid_yaml_and_nonstring_fields_leave_an_article() {
        let broken = extract("broken.md".into(), "---\ntitle: [broken\n---\n[B](b.md)");
        assert!(broken.title.is_empty());
        assert_eq!(broken.links, ["b.md"]);
        let scalar = extract("a.md".into(), "---\ntitle: 42\ntags: 一つ\n---\n");
        assert!(scalar.title.is_empty());
        assert_eq!(scalar.tags, ["一つ"]);
        assert_eq!(
            extract("a.md".into(), "---\ntitle: open\n[B](b.md)").links,
            ["b.md"]
        );
    }

    #[test]
    fn payload_does_not_grow_with_long_body_or_image_references() {
        let text = format!(
            "---\ntitle: A\ntags: [tag]\n---\n[B](b.md)\n{}",
            "本文 ![image](large.png)\n".repeat(20_000)
        );
        let article = extract("a.md".into(), &text);
        assert!(serde_json::to_vec(&article).unwrap().len() < 150);
        assert_eq!(article.links, ["b.md"]);
    }
}
