//! Bounded, namespace-scoped KV primitives. Product indexes/retention remain in plugins.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_ITEMS: usize = 128;

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
