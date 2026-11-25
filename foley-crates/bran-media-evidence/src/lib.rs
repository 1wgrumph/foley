//! Event-built Foley adapter over the vendored BRAN v0.4.0 library.
//!
//! Reads a `foley.steps/1` document, derives query terms from step targets,
//! typed values and the predicate text, scans the repository with BRAN's
//! read-only scanner, and returns ranked `foley.anchors/1` JSON.

use bran_core::graph::{GraphLimits, KnowledgeGraph};
use bran_core::scan::{RepositoryScanner, ScanConfig};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const MAX_ANCHORS: usize = 20;
const MAX_STEPS_BYTES: u64 = 1024 * 1024;
const MIN_TERM_CHARS: usize = 2;

struct Anchor<'a> {
    file: &'a str,
    line: usize,
    hits: usize,
    term: &'a str,
}

/// Returns the versioned anchors document for `steps_path` against `repo_root`.
pub fn locate(repo_root: &Path, steps_path: &Path) -> Result<String, String> {
    let terms = read_terms(steps_path)?;
    if terms.is_empty() {
        return Ok(document("miss", &[]));
    }
    // BRAN scan: read-only, ignore-aware, bounded, and refuses symlinks, so every
    // path it yields is a regular file inside `repo_root`.
    let snapshot = RepositoryScanner::new(repo_root, ScanConfig::default())
        .and_then(|scanner| scanner.scan())
        .map_err(|error| format!("BRAN scan failed: {error:?}"))?;
    let limits = GraphLimits::new(usize::MAX, usize::MAX).map_err(|e| e.to_string())?;
    let input = snapshot
        .graph_input()
        .map_err(|e| format!("BRAN graph input: {e:?}"))?;
    let graph = KnowledgeGraph::build(input, limits).map_err(|e| e.to_string())?;
    // BRAN query: files whose path or retained metadata names a term rank first among ties.
    let named: BTreeSet<String> = terms
        .iter()
        .flat_map(|term| graph.find(term, usize::MAX).items)
        .map(|node| node.id.as_str().to_owned())
        .collect();

    let mut anchors = Vec::new();
    for (path, entry) in &snapshot.entries {
        let Ok(text) = std::str::from_utf8(&entry.source) else {
            continue; // binary content holds no on-screen text
        };
        for (index, line) in text.split('\n').enumerate() {
            let matched: Vec<&str> = terms
                .iter()
                .map(String::as_str)
                .filter(|t| line.contains(t))
                .collect();
            // Longest term is the most specific; ties break on text for determinism.
            if let Some(term) = matched
                .iter()
                .copied()
                .max_by(|a, b| a.len().cmp(&b.len()).then(b.cmp(a)))
            {
                anchors.push(Anchor {
                    file: path,
                    line: index + 1,
                    hits: matched.len(),
                    term,
                });
            }
        }
    }
    anchors.sort_by(|a, b| {
        b.hits
            .cmp(&a.hits)
            .then_with(|| named.contains(b.file).cmp(&named.contains(a.file)))
            .then_with(|| a.file.cmp(b.file))
            .then_with(|| a.line.cmp(&b.line))
    });
    anchors.truncate(MAX_ANCHORS);
    let status = if anchors.is_empty() { "miss" } else { "ok" };
    Ok(document(status, &anchors))
}

fn read_terms(steps_path: &Path) -> Result<BTreeSet<String>, String> {
    let size = std::fs::metadata(steps_path)
        .map_err(|e| format!("steps: {e}"))?
        .len();
    if size > MAX_STEPS_BYTES {
        return Err(format!("steps: file exceeds {MAX_STEPS_BYTES} bytes"));
    }
    let raw = std::fs::read_to_string(steps_path).map_err(|e| format!("steps: {e}"))?;
    let root = Json::parse(&raw)?;
    if root.get("schema").and_then(Json::as_str) != Some("foley.steps/1") {
        return Err("steps: schema must be foley.steps/1".into());
    }
    let Some(Json::Array(steps)) = root.get("steps") else {
        return Err("steps: steps must be an array".into());
    };
    let mut terms = BTreeSet::new();
    let mut add = |value: Option<&Json>| {
        if let Some(text) = value.and_then(Json::as_str).map(str::trim) {
            if text.chars().count() >= MIN_TERM_CHARS {
                terms.insert(text.to_owned());
            }
        }
    };
    for step in steps {
        add(step.get("target"));
        add(step.get("value"));
    }
    if let Some(predicate) = root.get("predicate") {
        add(predicate.get("expected"));
        add(predicate.get("observed"));
    }
    Ok(terms)
}

fn document(status: &str, anchors: &[Anchor]) -> String {
    let items: Vec<String> = anchors
        .iter()
        .map(|a| {
            format!(
                "{{\"file\":{},\"line\":{},\"term\":{}}}",
                quote(a.file),
                a.line,
                quote(a.term)
            )
        })
        .collect();
    format!(
        "{{\"schema\":\"foley.anchors/1\",\"status\":\"{status}\",\"anchors\":[{}]}}",
        items.join(",")
    )
}

fn quote(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Minimal JSON reader: vendor/bran locks no JSON crate, and only strings are read.
enum Json {
    Null,
    Bool,
    Number,
    String(String),
    Array(Vec<Json>),
    Object(BTreeMap<String, Json>),
}

impl Json {
    fn parse(text: &str) -> Result<Json, String> {
        let mut parser = Parser {
            bytes: text.as_bytes(),
            at: 0,
            depth: 0,
        };
        let value = parser.value()?;
        parser.space();
        if parser.at != parser.bytes.len() {
            return Err("steps: trailing data after JSON".into());
        }
        Ok(value)
    }

    fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(map) => map.get(key),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(text) => Some(text),
            _ => None,
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
    depth: usize,
}

impl Parser<'_> {
    fn fail<T>(&self, what: &str) -> Result<T, String> {
        Err(format!("steps: invalid JSON at byte {}: {what}", self.at))
    }

    fn space(&mut self) {
        while matches!(self.bytes.get(self.at), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn literal(&mut self, word: &str, value: Json) -> Result<Json, String> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(value)
        } else {
            self.fail("unknown literal")
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        self.space();
        match self.bytes.get(self.at) {
            Some(b'{' | b'[') if self.depth == 64 => self.fail("nesting too deep"),
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => self.string().map(Json::String),
            Some(b't') => self.literal("true", Json::Bool),
            Some(b'f') => self.literal("false", Json::Bool),
            Some(b'n') => self.literal("null", Json::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => self.fail("expected a value"),
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.at;
        while matches!(
            self.bytes.get(self.at),
            Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
        ) {
            self.at += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.at]).unwrap_or("");
        match text.parse::<f64>() {
            Ok(n) if n.is_finite() => Ok(Json::Number),
            _ => self.fail("bad number"),
        }
    }

    fn array(&mut self) -> Result<Json, String> {
        self.at += 1;
        self.depth += 1;
        let mut items = Vec::new();
        self.space();
        if self.bytes.get(self.at) == Some(&b']') {
            self.at += 1;
        } else {
            loop {
                items.push(self.value()?);
                self.space();
                match self.bytes.get(self.at) {
                    Some(b',') => self.at += 1,
                    Some(b']') => {
                        self.at += 1;
                        break;
                    }
                    _ => return self.fail("expected , or ]"),
                }
            }
        }
        self.depth -= 1;
        Ok(Json::Array(items))
    }

    fn object(&mut self) -> Result<Json, String> {
        self.at += 1;
        self.depth += 1;
        let mut map = BTreeMap::new();
        self.space();
        if self.bytes.get(self.at) == Some(&b'}') {
            self.at += 1;
        } else {
            loop {
                self.space();
                if self.bytes.get(self.at) != Some(&b'"') {
                    return self.fail("expected a key");
                }
                let key = self.string()?;
                self.space();
                if self.bytes.get(self.at) != Some(&b':') {
                    return self.fail("expected :");
                }
                self.at += 1;
                let value = self.value()?;
                if map.insert(key, value).is_some() {
                    return self.fail("duplicate key");
                }
                self.space();
                match self.bytes.get(self.at) {
                    Some(b',') => self.at += 1,
                    Some(b'}') => {
                        self.at += 1;
                        break;
                    }
                    _ => return self.fail("expected , or }"),
                }
            }
        }
        self.depth -= 1;
        Ok(Json::Object(map))
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let digits = self
            .bytes
            .get(self.at..self.at + 4)
            .and_then(|d| std::str::from_utf8(d).ok());
        match digits.and_then(|d| u32::from_str_radix(d, 16).ok()) {
            Some(code) => {
                self.at += 4;
                Ok(code)
            }
            None => self.fail("bad \\u escape"),
        }
    }

    fn string(&mut self) -> Result<String, String> {
        self.at += 1;
        let mut out = String::new();
        loop {
            let start = self.at;
            while !matches!(
                self.bytes.get(self.at),
                None | Some(b'"' | b'\\' | 0..=0x1f)
            ) {
                self.at += 1;
            }
            // Input came from &str and stops only on ASCII, so the slice is valid UTF-8.
            out.push_str(std::str::from_utf8(&self.bytes[start..self.at]).expect("utf8 slice"));
            match self.bytes.get(self.at) {
                Some(b'"') => {
                    self.at += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.at += 1;
                    let escape = self.bytes.get(self.at).copied();
                    self.at += 1;
                    let c = match escape {
                        Some(b'"') => '"',
                        Some(b'\\') => '\\',
                        Some(b'/') => '/',
                        Some(b'b') => '\u{8}',
                        Some(b'f') => '\u{c}',
                        Some(b'n') => '\n',
                        Some(b'r') => '\r',
                        Some(b't') => '\t',
                        Some(b'u') => {
                            let high = self.hex4()?;
                            let code = if (0xd800..0xdc00).contains(&high) {
                                if !self.bytes[self.at..].starts_with(b"\\u") {
                                    return self.fail("lone surrogate");
                                }
                                self.at += 2;
                                let low = self.hex4()?;
                                if !(0xdc00..0xe000).contains(&low) {
                                    return self.fail("bad surrogate pair");
                                }
                                0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00)
                            } else {
                                high
                            };
                            match char::from_u32(code) {
                                Some(c) => c,
                                None => return self.fail("bad code point"),
                            }
                        }
                        _ => return self.fail("bad escape"),
                    };
                    out.push(c);
                }
                _ => return self.fail("unterminated string"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Json;

    #[test]
    fn json_reader_accepts_valid_and_refuses_invalid() {
        let value = Json::parse(r#"{"a":[1,-2.5e3,true,null,"x\u00e9\n"],"b":{}}"#).unwrap();
        assert!(
            matches!(value.get("a"), Some(Json::Array(items)) if items[4].as_str() == Some("x\u{e9}\n"))
        );
        for bad in [
            "",
            "{",
            "{\"a\":1,}",
            "[1 2]",
            "\"\\q\"",
            "{\"a\":1,\"a\":2}",
            "1 2",
            "\"\\ud800\"",
        ] {
            assert!(Json::parse(bad).is_err(), "accepted {bad:?}");
        }
        assert!(Json::parse(&"[".repeat(65)).is_err());
    }
}
