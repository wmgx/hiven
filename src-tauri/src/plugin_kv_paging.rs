//! Bounded, namespace-scoped KV primitives. Product indexes/retention remain in plugins.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_ITEMS: usize = 128;
const MAX_SEARCH_TERMS: usize = 64;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageOptions {
    prefix: String,
    after: Option<String>,
    limit: Option<usize>,
    order: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    key: String,
    value_json: String,
    updated_at: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    entries: Vec<Entry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedSearchOptions {
    index_prefix: String,
    value_prefix: String,
    after: Option<String>,
    limit: Option<usize>,
    scan_limit: Option<usize>,
    query: String,
    #[serde(default)]
    match_mode: RelatedSearchMatchMode,
    id_path: String,
    index_paths: Vec<String>,
    #[serde(default)]
    index_path_groups: Vec<Vec<String>>,
    value_paths: Vec<String>,
}
#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum RelatedSearchMatchMode {
    #[default]
    Literal,
    AllTerms,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedSearchEntry { key: String, value_json: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedSearchPage { entries: Vec<RelatedSearchEntry>, next_cursor: Option<String>, scanned: usize }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArrayPageOptions {
    key: String,
    path: String,
    after_index: Option<i64>,
    limit: Option<usize>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArrayEntry {
    index: i64,
    value_json: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArrayPage {
    entries: Vec<ArrayEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_index: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Check {
    key: String,
    expected_json: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum Operation {
    Set {
        key: String,
        #[serde(rename = "valueJson")]
        value_json: String,
    },
    Delete {
        key: String,
    },
}
#[derive(Deserialize)]
pub(crate) struct Batch {
    #[serde(default)]
    checks: Vec<Check>,
    operations: Vec<Operation>,
}
#[derive(Serialize)]
pub(crate) struct BatchResult {
    committed: bool,
}

fn limit(value: Option<usize>) -> Result<usize, String> {
    let value = value.unwrap_or(64);
    if value == 0 || value > MAX_ITEMS {
        return Err("Plugin KV page limit must be 1–128".into());
    }
    Ok(value)
}
fn key(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.contains('\0') || value.len() > 2048 {
        return Err("Invalid plugin KV key".into());
    }
    Ok(())
}
fn prefix_upper(prefix: &str) -> Option<String> {
    let mut chars: Vec<char> = prefix.chars().collect();
    while let Some(last) = chars.pop() {
        let mut next = last as u32 + 1;
        if next == 0xd800 {
            next = 0xe000;
        }
        if let Some(next) = char::from_u32(next) {
            chars.push(next);
            return Some(chars.into_iter().collect());
        }
    }
    None
}

fn json_path<'a>(value: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    if path == "$" { return Some(value); }
    if !valid_json_path(path) { return None; }
    let mut current = value;
    for field in path[2..].split('.') {
        if field.is_empty() || !field.bytes().enumerate().all(|(i, c)| c.is_ascii_alphabetic() || c == b'_' || (i > 0 && c.is_ascii_digit())) { return None; }
        current = current.get(field)?;
    }
    Some(current)
}

fn valid_json_path(path: &str) -> bool {
    path == "$" || (path.starts_with("$.") && path.len() <= 512 && path[2..].split('.').all(|field| !field.is_empty() && field.bytes().enumerate().all(|(i, c)| c.is_ascii_alphabetic() || c == b'_' || (i > 0 && c.is_ascii_digit()))))
}

fn is_ecmascript_whitespace(value: char) -> bool {
    matches!(value,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

fn contains_search_terms(value: &serde_json::Value, terms: &[String], terms_upper: &[String]) -> bool {
    match value {
        serde_json::Value::String(text) => {
            let lower = text.to_lowercase();
            let upper = text.to_uppercase();
            terms.iter().zip(terms_upper).all(|(term, term_upper)| lower.contains(term) || upper.contains(term_upper))
        }
        serde_json::Value::Array(values) => values.iter().any(|value| contains_search_terms(value, terms, terms_upper)),
        serde_json::Value::Number(number) => {
            let text = number.to_string();
            terms.iter().all(|term| text.contains(term))
        }
        _ => false,
    }
}

pub(crate) fn related_search(db: &Connection, source: &str, plugin: &str, options: RelatedSearchOptions) -> Result<RelatedSearchPage, String> {
    let result_limit = limit(options.limit)?;
    let scan_limit = options.scan_limit.unwrap_or(512);
    if scan_limit == 0 || scan_limit > 2048 { return Err("Plugin KV search scan limit must be 1–2048".into()); }
    if options.index_prefix.contains('\0') || options.value_prefix.contains('\0') || options.index_prefix.len() > 2048 || options.value_prefix.len() > 2048 { return Err("Invalid plugin KV search prefix".into()); }
    if let Some(after) = &options.after { key(after)?; if !after.starts_with(&options.index_prefix) { return Err("Cursor is outside the search index prefix".into()); } }
    if !valid_json_path(&options.id_path) || options.index_paths.iter().chain(options.value_paths.iter()).any(|path| !valid_json_path(path)) || options.index_path_groups.iter().flatten().any(|path| !valid_json_path(path)) { return Err("Invalid plugin KV search path".into()); }
    if options.index_paths.len() > 16 || options.value_paths.len() > 16 || options.index_path_groups.len() > 8 || options.index_path_groups.iter().any(|paths| paths.len() > 8) { return Err("Too many plugin KV search paths".into()); }
    let lowered_query = options.query.to_lowercase();
    let mut terms = Vec::new();
    if options.match_mode == RelatedSearchMatchMode::Literal {
        let query = lowered_query.trim();
        if query.is_empty() { return Err("Plugin KV search query is empty".into()); }
        terms.push(query.to_owned());
    } else {
        // Keep native candidate generation aligned with ECMAScript `\s`, which
        // includes U+FEFF but not U+0085. JS remains the authoritative recheck.
        for term in lowered_query.split(is_ecmascript_whitespace).filter(|term| !term.is_empty()) {
            if !terms.iter().any(|existing| existing == term) {
                terms.push(term.to_owned());
            }
        }
        if terms.is_empty() { return Err("Plugin KV search query is empty".into()); }
        if terms.len() > MAX_SEARCH_TERMS { return Err("Plugin KV search has too many terms".into()); }
    }
    let terms_upper = terms.iter().map(|term| term.to_uppercase()).collect::<Vec<_>>();
    let upper = prefix_upper(&options.index_prefix);
    let sql = "SELECT i.key, i.value_json, v.value_json FROM plugin_kv i LEFT JOIN plugin_kv v ON v.source=i.source AND v.plugin_id=i.plugin_id AND v.key=(?4 || json_extract(i.value_json, ?5)) WHERE i.source=?1 AND i.plugin_id=?2 AND i.key>=?3 AND (?6 IS NULL OR i.key<?6) AND (?7 IS NULL OR i.key>?7) ORDER BY i.key ASC LIMIT ?8";
    let mut statement = db.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = statement.query(params![source, plugin, options.index_prefix, options.value_prefix, options.id_path, upper, options.after, (scan_limit + 1) as i64]).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut scanned = 0usize;
    let mut last_key = None;
    let mut has_more = false;
    let mut bytes = 0usize;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if scanned == scan_limit { has_more = true; break; }
        let item_key: String = row.get(0).map_err(|e| e.to_string())?;
        let index_json: String = row.get(1).map_err(|e| e.to_string())?;
        let related_json: Option<String> = row.get(2).map_err(|e| e.to_string())?;
        let index_value: serde_json::Value = serde_json::from_str(&index_json).map_err(|e| e.to_string())?;
        let index_match = options.index_paths.iter().filter_map(|path| json_path(&index_value, path)).any(|value| contains_search_terms(value, &terms, &terms_upper));
        let group_match = options.index_path_groups.iter().any(|paths| {
            let combined = paths.iter().filter_map(|path| json_path(&index_value, path)).filter_map(|value| match value {
                serde_json::Value::String(text) => Some(text.clone()),
                serde_json::Value::Number(number) => Some(number.to_string()),
                _ => None,
            }).collect::<Vec<_>>().join(" ");
            contains_search_terms(&serde_json::Value::String(combined), &terms, &terms_upper)
        });
        let related_match = if index_match || group_match { false } else if let Some(raw) = related_json {
            let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            options.value_paths.iter().filter_map(|path| json_path(&value, path)).any(|value| contains_search_terms(value, &terms, &terms_upper))
        } else { false };
        if index_match || group_match || related_match {
            let entry_bytes = item_key.len() + index_json.len();
            if bytes + entry_bytes > MAX_BYTES {
                if entries.is_empty() { return Err("Plugin KV search value exceeds page byte limit".into()); }
                has_more = true;
                break;
            }
            bytes += entry_bytes;
            entries.push(RelatedSearchEntry { key: item_key.clone(), value_json: index_json });
        }
        scanned += 1;
        last_key = Some(item_key);
        if entries.len() == result_limit { has_more = true; break; }
    }
    Ok(RelatedSearchPage { entries, next_cursor: if has_more { last_key } else { None }, scanned })
}

#[cfg(test)]
mod related_search_tests {
    use super::*;

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE plugin_kv(source TEXT, plugin_id TEXT, key TEXT, value_json TEXT, updated_at INTEGER, PRIMARY KEY(source,plugin_id,key));").unwrap();
        db
    }
    fn put(db: &Connection, key: &str, value: serde_json::Value) {
        db.execute("INSERT INTO plugin_kv VALUES('builtin','clipboard-history',?1,?2,0)", params![key, value.to_string()]).unwrap();
    }
    fn options(query: &str) -> RelatedSearchOptions {
        RelatedSearchOptions { index_prefix: "history/v2/order/".into(), value_prefix: "history/items/".into(), after: None, limit: Some(100), scan_limit: Some(512), query: query.into(), match_mode: RelatedSearchMatchMode::Literal, id_path: "$.id".into(), index_paths: vec!["$.preview".into()], index_path_groups: vec![vec!["$.contentType".into(), "$.width".into(), "$.height".into()]], value_paths: vec!["$.text".into()] }
    }
    #[test]
    fn searches_related_unicode_and_preserves_index_cursor_order() {
        let db = database();
        put(&db, "history/v2/order/001/a", serde_json::json!({"id":"a","preview":"short"}));
        put(&db, "history/items/a", serde_json::json!({"text":"long 中文 CAFÉ"}));
        put(&db, "history/v2/order/002/b", serde_json::json!({"id":"b","preview":"none"}));
        put(&db, "history/items/b", serde_json::json!({"text":"absent"}));
        let page = related_search(&db, "builtin", "clipboard-history", options("café")).unwrap();
        assert_eq!(page.scanned, 2);
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].key, "history/v2/order/001/a");
        assert!(page.next_cursor.is_none());
    }
    #[test]
    fn supports_composite_fields_and_rejects_invalid_paths() {
        let db = database();
        put(&db, "history/v2/order/001/image", serde_json::json!({"id":"image","contentType":"image/png","width":640,"height":480}));
        assert_eq!(related_search(&db, "builtin", "clipboard-history", options("640 480")).unwrap().entries.len(), 1);
        let mut invalid = options("x"); invalid.id_path = "$[*]".into();
        assert!(related_search(&db, "builtin", "clipboard-history", invalid).is_err());
    }

    #[test]
    fn all_terms_match_one_field_without_changing_literal_default() {
        let db = database();
        put(&db, "history/v2/order/001/full", serde_json::json!({"id":"full","preview":"alpha"}));
        put(&db, "history/items/full", serde_json::json!({"text":"alpha middle\n中文 gamma"}));
        put(&db, "history/v2/order/002/split", serde_json::json!({"id":"split","preview":"alpha"}));
        put(&db, "history/items/split", serde_json::json!({"text":"gamma only"}));
        put(&db, "history/v2/order/003/files", serde_json::json!({"id":"files","preview":"none","fileNames":["alpha.txt","gamma.txt"]}));

        assert!(related_search(&db, "builtin", "clipboard-history", options("alpha gamma")).unwrap().entries.is_empty());
        let mut all_terms = options(" alpha\nALPHA  中文 gamma ");
        all_terms.match_mode = RelatedSearchMatchMode::AllTerms;
        all_terms.index_paths.push("$.fileNames".into());
        let entries = related_search(&db, "builtin", "clipboard-history", all_terms).unwrap().entries;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "history/v2/order/001/full");

        let mut byte_order_mark = options("alpha\u{feff}gamma");
        byte_order_mark.match_mode = RelatedSearchMatchMode::AllTerms;
        assert_eq!(related_search(&db, "builtin", "clipboard-history", byte_order_mark).unwrap().entries.len(), 1);
        let mut next_line = options("alpha\u{0085}gamma");
        next_line.match_mode = RelatedSearchMatchMode::AllTerms;
        assert!(related_search(&db, "builtin", "clipboard-history", next_line).unwrap().entries.is_empty());
    }

    #[test]
    fn all_terms_keeps_per_query_work_bounded() {
        let db = database();
        let mut too_many = options(&(0..=MAX_SEARCH_TERMS).map(|index| format!("term{index}")).collect::<Vec<_>>().join(" "));
        too_many.match_mode = RelatedSearchMatchMode::AllTerms;
        assert!(related_search(&db, "builtin", "clipboard-history", too_many).is_err());
    }
}

pub(crate) fn page(
    db: &Connection,
    source: &str,
    plugin: &str,
    options: PageOptions,
) -> Result<Page, String> {
    let count = limit(options.limit)?;
    if options.prefix.contains('\0') || options.prefix.len() > 2048 {
        return Err("Invalid plugin KV prefix".into());
    }
    if let Some(after) = &options.after {
        key(after)?;
        if !after.starts_with(&options.prefix) {
            return Err("Cursor is outside the prefix".into());
        }
    }
    let (order, comparison) = match options.order.as_deref().unwrap_or("asc") {
        "asc" => ("ASC", ">"),
        "desc" => ("DESC", "<"),
        _ => return Err("Invalid plugin KV page order".into()),
    };
    let upper = prefix_upper(&options.prefix);
    let upper_clause = if upper.is_some() { " AND key<?4" } else { "" };
    let cursor_clause = if options.after.is_some() {
        format!(" AND key {comparison} ?5")
    } else {
        String::new()
    };
    let sql = format!("SELECT key, value_json, updated_at, length(CAST(value_json AS BLOB)) FROM plugin_kv WHERE source=?1 AND plugin_id=?2 AND key>=?3{upper_clause}{cursor_clause} ORDER BY key {order} LIMIT ?6");
    let mut statement = db.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![
            source,
            plugin,
            options.prefix,
            upper,
            options.after,
            (count + 1) as i64
        ])
        .map_err(|e| e.to_string())?;
    let mut result = Page {
        entries: Vec::new(),
        next_cursor: None,
    };
    let mut bytes = 0usize;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let size: i64 = row.get(3).map_err(|e| e.to_string())?;
        let item_key: String = row.get(0).map_err(|e| e.to_string())?;
        let size = usize::try_from(size).map_err(|_| "Invalid KV size")? + item_key.len();
        if result.entries.len() == count || bytes + size > MAX_BYTES {
            if result.entries.is_empty() {
                return Err("Plugin KV value exceeds page byte limit".into());
            }
            result.next_cursor = result.entries.last().map(|e| e.key.clone());
            break;
        }
        bytes += size;
        result.entries.push(Entry {
            key: item_key,
            value_json: row.get(1).map_err(|e| e.to_string())?,
            updated_at: row.get(2).map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

pub(crate) fn array_page(
    db: &Connection,
    source: &str,
    plugin: &str,
    options: ArrayPageOptions,
) -> Result<ArrayPage, String> {
    key(&options.key)?;
    let count = limit(options.limit)?;
    // Only "$" and dotted ASCII field names; no SQL, wildcard, recursive paths or expressions.
    if options.path != "$"
        && (!options.path.starts_with("$.")
            || !options.path[2..].split('.').all(|field| {
                !field.is_empty()
                    && field.bytes().enumerate().all(|(i, c)| {
                        c.is_ascii_alphabetic() || c == b'_' || (i > 0 && c.is_ascii_digit())
                    })
            }))
    {
        return Err("Invalid plugin KV array path".into());
    }
    if options.path.len() > 512 || options.after_index.is_some_and(|index| index < 0) {
        return Err("Invalid plugin KV array cursor".into());
    }
    let kind: Option<Option<String>> = db.query_row("SELECT json_type(value_json, ?4) FROM plugin_kv WHERE source=?1 AND plugin_id=?2 AND key=?3", params![source, plugin, options.key, options.path], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if kind.is_some() && kind != Some(Some("array".into())) {
        return Err("Plugin KV path is not an array".into());
    }
    let mut statement = db.prepare("SELECT j.key, CASE j.type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE json_quote(j.value) END, length(CAST(json_quote(j.value) AS BLOB)) FROM plugin_kv p, json_each(p.value_json, ?4) j WHERE p.source=?1 AND p.plugin_id=?2 AND p.key=?3 AND j.key>?5 ORDER BY j.key ASC LIMIT ?6").map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![
            source,
            plugin,
            options.key,
            options.path,
            options.after_index.unwrap_or(-1),
            (count + 1) as i64
        ])
        .map_err(|e| e.to_string())?;
    let mut result = ArrayPage {
        entries: Vec::new(),
        next_index: None,
    };
    let mut bytes = 0usize;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let size: i64 = row.get(2).map_err(|e| e.to_string())?;
        let size = usize::try_from(size).map_err(|_| "Invalid KV size")?;
        if result.entries.len() == count || bytes + size > MAX_BYTES {
            if result.entries.is_empty() {
                return Err("Plugin KV array item exceeds page byte limit".into());
            }
            result.next_index = result.entries.last().map(|entry| entry.index);
            break;
        }
        bytes += size;
        result.entries.push(ArrayEntry {
            index: row.get(0).map_err(|e| e.to_string())?,
            value_json: row.get(1).map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

pub(crate) fn batch(
    db: &mut Connection,
    source: &str,
    plugin: &str,
    input: Batch,
    updated_at: i64,
) -> Result<BatchResult, String> {
    if input.checks.len() > MAX_ITEMS || input.operations.len() > MAX_ITEMS {
        return Err("Plugin KV batch exceeds operation limit".into());
    }
    let mut bytes = 0usize;
    for check in &input.checks {
        key(&check.key)?;
        bytes += check.key.len() + check.expected_json.as_ref().map_or(0, String::len);
    }
    for operation in &input.operations {
        let (item_key, value) = match operation {
            Operation::Set { key, value_json } => (key, Some(value_json)),
            Operation::Delete { key } => (key, None),
        };
        key(item_key)?;
        bytes += item_key.len() + value.map_or(0, String::len);
    }
    if bytes > MAX_BYTES {
        return Err("Plugin KV batch exceeds byte limit".into());
    }
    for operation in &input.operations {
        if let Operation::Set { value_json, .. } = operation {
            if !db
                .query_row("SELECT json_valid(?1)", [value_json], |row| {
                    row.get::<_, bool>(0)
                })
                .map_err(|e| e.to_string())?
            {
                return Err("Invalid plugin KV JSON".into());
            }
        }
    }
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    for check in input.checks {
        // Compare inside SQLite, avoiding materializing a potentially large stored value.
        let matches: Option<bool> = tx
            .query_row(
                "SELECT value_json=?4 FROM plugin_kv WHERE source=?1 AND plugin_id=?2 AND key=?3",
                params![source, plugin, check.key, check.expected_json],
                |row| row.get::<_, Option<bool>>(0).map(|v| v.unwrap_or(false)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let matches = matches.unwrap_or(check.expected_json.is_none());
        if !matches {
            return Ok(BatchResult { committed: false });
        }
    }
    for operation in input.operations {
        match operation {
            Operation::Set { key, value_json } => {
                tx.execute("INSERT INTO plugin_kv(source,plugin_id,key,value_json,byte_size,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(source,plugin_id,key) DO UPDATE SET value_json=excluded.value_json,byte_size=excluded.byte_size,updated_at=excluded.updated_at", params![source, plugin, key, value_json, value_json.len() as i64, updated_at]).map_err(|e| e.to_string())?;
            }
            Operation::Delete { key } => {
                tx.execute(
                    "DELETE FROM plugin_kv WHERE source=?1 AND plugin_id=?2 AND key=?3",
                    params![source, plugin, key],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(BatchResult { committed: true })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE plugin_kv(source TEXT,plugin_id TEXT,key TEXT,value_json TEXT,byte_size INTEGER,updated_at INTEGER,PRIMARY KEY(source,plugin_id,key));").unwrap();
        db
    }
    fn put(db: &Connection, namespace: &str, key: &str, value: &str) {
        db.execute(
            "INSERT OR REPLACE INTO plugin_kv VALUES('builtin',?1,?2,?3,?4,1)",
            params![namespace, key, value, value.len() as i64],
        )
        .unwrap();
    }
    fn options(prefix: &str, after: Option<String>, order: &str) -> PageOptions {
        PageOptions {
            prefix: prefix.into(),
            after,
            limit: Some(2),
            order: Some(order.into()),
        }
    }
    #[test]
    fn pages_are_ordered_scoped_exclusive_and_bounded() {
        let db = database();
        for key in ["items/001", "items/002", "items/003", "else/000"] {
            put(&db, "one", key, "{}")
        }
        put(&db, "two", "items/004", "{}");
        let first = page(&db, "builtin", "one", options("items/", None, "asc")).unwrap();
        assert_eq!(
            first
                .entries
                .iter()
                .map(|entry| entry.key.as_str())
                .collect::<Vec<_>>(),
            vec!["items/001", "items/002"]
        );
        let second = page(
            &db,
            "builtin",
            "one",
            options("items/", first.next_cursor, "asc"),
        )
        .unwrap();
        assert_eq!(second.entries[0].key, "items/003");
        assert!(second.next_cursor.is_none());
        let last = page(&db, "builtin", "one", options("items/", None, "desc")).unwrap();
        assert_eq!(last.entries[0].key, "items/003");
        let rest = page(
            &db,
            "builtin",
            "one",
            options("items/", last.next_cursor, "desc"),
        )
        .unwrap();
        assert_eq!(rest.entries[0].key, "items/001");
    }
    #[test]
    fn legacy_array_uses_authoritative_membership_and_keeps_source() {
        let db = database();
        let original = r#"{"entries":[{"id":"kept"},true,false,null,"text",12]}"#;
        put(&db, "one", "index", original);
        put(&db, "one", "items/orphan", "{}");
        let mut after = None;
        let mut values = Vec::new();
        loop {
            let result = array_page(
                &db,
                "builtin",
                "one",
                ArrayPageOptions {
                    key: "index".into(),
                    path: "$.entries".into(),
                    after_index: after,
                    limit: Some(2),
                },
            )
            .unwrap();
            values.extend(result.entries.into_iter().map(|entry| entry.value_json));
            if result.next_index.is_none() {
                break;
            }
            after = result.next_index;
        }
        assert_eq!(
            values,
            vec![
                r#"{"id":"kept"}"#,
                "true",
                "false",
                "null",
                r#""text""#,
                "12"
            ]
        );
        assert_eq!(
            db.query_row(
                "SELECT value_json FROM plugin_kv WHERE key='index'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            original
        );
        assert!(array_page(
            &db,
            "builtin",
            "one",
            ArrayPageOptions {
                key: "index".into(),
                path: "$.entries[*]".into(),
                after_index: None,
                limit: None
            }
        )
        .is_err());
    }
    #[test]
    fn missing_array_is_empty_but_invalid_existing_source_rejects() {
        let db = database();
        let request = || ArrayPageOptions {
            key: "legacy".into(),
            path: "$.entries".into(),
            after_index: None,
            limit: None,
        };
        assert!(array_page(&db, "builtin", "one", request())
            .unwrap()
            .entries
            .is_empty());
        for source in ["{}", r#"{"entries":{}}"#, "malformed"] {
            put(&db, "one", "legacy", source);
            assert!(array_page(&db, "builtin", "one", request()).is_err());
        }
    }

    #[test]
    fn native_write_error_rolls_back_preceding_operations() {
        let mut db = database();
        db.execute_batch("CREATE TRIGGER reject_bad BEFORE INSERT ON plugin_kv WHEN NEW.key='bad' BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;").unwrap();
        let result = batch(
            &mut db,
            "builtin",
            "one",
            Batch {
                checks: vec![],
                operations: vec![
                    Operation::Set {
                        key: "good".into(),
                        value_json: "1".into(),
                    },
                    Operation::Set {
                        key: "bad".into(),
                        value_json: "2".into(),
                    },
                ],
            },
            1,
        );
        assert!(result.is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM plugin_kv", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn cas_conflict_has_no_partial_write_and_success_is_namespace_scoped() {
        let mut db = database();
        put(&db, "one", "version", "1");
        put(&db, "two", "version", "1");
        let input = |version| Batch {
            checks: vec![Check {
                key: "version".into(),
                expected_json: Some(version),
            }],
            operations: vec![
                Operation::Set {
                    key: "version".into(),
                    value_json: "2".into(),
                },
                Operation::Set {
                    key: "item".into(),
                    value_json: "{}".into(),
                },
            ],
        };
        assert!(
            !batch(&mut db, "builtin", "one", input("0".into()), 2)
                .unwrap()
                .committed
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM plugin_kv WHERE key='item'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert!(
            batch(&mut db, "builtin", "one", input("1".into()), 2)
                .unwrap()
                .committed
        );
        assert!(
            !batch(&mut db, "builtin", "one", input("1".into()), 3)
                .unwrap()
                .committed
        );
        assert_eq!(
            db.query_row(
                "SELECT value_json FROM plugin_kv WHERE plugin_id='two' AND key='version'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "1"
        );
        assert!(
            !batch(
                &mut db,
                "builtin",
                "one",
                Batch {
                    checks: vec![Check {
                        key: "item".into(),
                        expected_json: None
                    }],
                    operations: vec![Operation::Delete { key: "item".into() }]
                },
                4
            )
            .unwrap()
            .committed
        );
        assert!(
            batch(
                &mut db,
                "builtin",
                "one",
                Batch {
                    checks: vec![Check {
                        key: "absent".into(),
                        expected_json: None
                    }],
                    operations: vec![Operation::Delete { key: "item".into() }]
                },
                4
            )
            .unwrap()
            .committed
        );
    }
    #[test]
    fn invalid_or_oversized_writes_leave_all_records_unchanged() {
        let mut db = database();
        assert!(batch(
            &mut db,
            "builtin",
            "one",
            Batch {
                checks: vec![],
                operations: vec![
                    Operation::Set {
                        key: "fine".into(),
                        value_json: "{}".into()
                    },
                    Operation::Set {
                        key: "bad".into(),
                        value_json: "invalid".into()
                    }
                ]
            },
            1
        )
        .is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM plugin_kv", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        put(
            &db,
            "one",
            "large",
            &format!("\"{}\"", "x".repeat(MAX_BYTES)),
        );
        assert!(page(&db, "builtin", "one", options("large", None, "asc")).is_err());
        assert!(page(
            &db,
            "builtin",
            "one",
            options("prefix", Some("outside".into()), "asc")
        )
        .is_err());
    }
}
