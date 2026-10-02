//! Greets people by name.

/// Builds the greeting for a name.
pub fn hello(name: &str) -> String {
    format!("hi {}", name)
}

fn helper() -> &'static str {
    "unused"
}
