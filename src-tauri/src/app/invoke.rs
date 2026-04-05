use crate::util::{check_file_or_append, get_download_message_with_lang, show_toast, MessageType};
use std::fs::{self, File};
use std::io::Write;
use std::net::IpAddr;
use std::str::FromStr;
use tauri::http::Method;
use tauri::{command, AppHandle, Manager, Url, WebviewWindow};
use tauri_plugin_http::reqwest::{ClientBuilder, Request};

#[cfg(target_os = "macos")]
use tauri::Theme;

#[derive(serde::Deserialize)]
pub struct DownloadFileParams {
    url: String,
    filename: String,
    language: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct BinaryDownloadParams {
    filename: String,
    binary: Vec<u8>,
    language: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct NotificationParams {
    title: String,
    body: String,
    icon: String,
}

/// Validates that a URL is safe to access (not pointing to internal/private networks)
fn is_safe_url(url: &Url) -> Result<(), String> {
    let host = url.host_str().ok_or("URL has no host")?;
    
    // Check for localhost
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return Err("SSRF protection: Cannot access localhost".to_string());
    }
    
    // Check for private IP ranges
    if let Ok(ip) = IpAddr::from_str(host) {
        match ip {
            IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                // 10.0.0.0/8
                if octets[0] == 10 {
                    return Err("SSRF protection: Cannot access private network (10.0.0.0/8)".to_string());
                }
                // 172.16.0.0/12
                if octets[0] == 172 && (octets[1] >= 16 && octets[1] <= 31) {
                    return Err("SSRF protection: Cannot access private network (172.16.0.0/12)".to_string());
                }
                // 192.168.0.0/16
                if octets[0] == 192 && octets[1] == 168 {
                    return Err("SSRF protection: Cannot access private network (192.168.0.0/16)".to_string());
                }
                // 127.0.0.0/8
                if octets[0] == 127 {
                    return Err("SSRF protection: Cannot access loopback network (127.0.0.0/8)".to_string());
                }
                // 169.254.0.0/16 (link-local)
                if octets[0] == 169 && octets[1] == 254 {
                    return Err("SSRF protection: Cannot access link-local network (169.254.0.0/16)".to_string());
                }
                // 0.0.0.0
                if octets == [0, 0, 0, 0] {
                    return Err("SSRF protection: Cannot access 0.0.0.0".to_string());
                }
            }
            IpAddr::V6(ipv6) => {
                let segments = ipv6.segments();
                // ::1 (loopback)
                if ipv6.is_loopback() {
                    return Err("SSRF protection: Cannot access IPv6 loopback (::1)".to_string());
                }
                // fc00::/7 (unique local)
                if (segments[0] & 0xfe00) == 0xfc00 {
                    return Err("SSRF protection: Cannot access IPv6 unique local (fc00::/7)".to_string());
                }
                // fe80::/10 (link-local)
                if (segments[0] & 0xffc0) == 0xfe80 {
                    return Err("SSRF protection: Cannot access IPv6 link-local (fe80::/10)".to_string());
                }
            }
        }
    }
    
    // Check for internal hostnames
    let hostname = host.to_lowercase();
    if hostname.ends_with(".local") 
        || hostname.ends_with(".internal") 
        || hostname.ends_with(".private")
        || hostname == "host.docker.internal"
    {
        return Err("SSRF protection: Cannot access internal hostname".to_string());
    }
    
    Ok(())
}

/// Sanitizes filename to prevent path traversal attacks
fn sanitize_filename(filename: &str) -> Result<String, String> {
    // Remove any path components
    let sanitized = std::path::Path::new(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid filename: contains path traversal or is empty")?;
    
    // Check for null bytes
    if sanitized.contains('\0') {
        return Err("Invalid filename: contains null byte".to_string());
    }
    
    // Ensure filename doesn't start with dot (hidden files on Unix)
    if sanitized.starts_with('.') {
        return Err("Invalid filename: cannot start with dot".to_string());
    }
    
    // Limit filename length
    if sanitized.len() > 255 {
        return Err("Invalid filename: too long".to_string());
    }
    
    Ok(sanitized.to_string())
}

#[command]
pub async fn download_file(app: AppHandle, params: DownloadFileParams) -> Result<(), String> {
    let window: WebviewWindow = app.get_webview_window("pake").ok_or("Window not found")?;

    show_toast(
        &window,
        &get_download_message_with_lang(MessageType::Start, params.language.clone()),
    );

    let download_dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("Failed to get download dir: {}", e))?;

    // Sanitize filename to prevent path traversal
    let sanitized_filename = sanitize_filename(&params.filename)?;
    let output_path = download_dir.join(&sanitized_filename);

    let path_str = output_path.to_str().ok_or("Invalid output path")?;

    let file_path = check_file_or_append(path_str);

    let client = ClientBuilder::new()
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let url = Url::from_str(&params.url).map_err(|e| format!("Invalid URL: {}", e))?;

    // Validate URL to prevent SSRF attacks
    is_safe_url(&url)?;

    let request = Request::new(Method::GET, url);

    let response = client.execute(request).await;

    match response {
        Ok(mut res) => {
            let mut file =
                File::create(file_path).map_err(|e| format!("Failed to create file: {}", e))?;

            while let Some(chunk) = res
                .chunk()
                .await
                .map_err(|e| format!("Failed to get chunk: {}", e))?
            {
                file.write_all(&chunk)
                    .map_err(|e| format!("Failed to write chunk: {}", e))?;
            }

            show_toast(
                &window,
                &get_download_message_with_lang(MessageType::Success, params.language.clone()),
            );
            Ok(())
        }
        Err(e) => {
            show_toast(
                &window,
                &get_download_message_with_lang(MessageType::Failure, params.language),
            );
            Err(e.to_string())
        }
    }
}

#[command]
pub async fn download_file_by_binary(
    app: AppHandle,
    params: BinaryDownloadParams,
) -> Result<(), String> {
    let window: WebviewWindow = app.get_webview_window("pake").ok_or("Window not found")?;

    show_toast(
        &window,
        &get_download_message_with_lang(MessageType::Start, params.language.clone()),
    );

    let download_dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("Failed to get download dir: {}", e))?;

    // Sanitize filename to prevent path traversal
    let sanitized_filename = sanitize_filename(&params.filename)?;
    let output_path = download_dir.join(&sanitized_filename);

    let path_str = output_path.to_str().ok_or("Invalid output path")?;

    let file_path = check_file_or_append(path_str);

    match fs::write(file_path, &params.binary) {
        Ok(_) => {
            show_toast(
                &window,
                &get_download_message_with_lang(MessageType::Success, params.language.clone()),
            );
            Ok(())
        }
        Err(e) => {
            show_toast(
                &window,
                &get_download_message_with_lang(MessageType::Failure, params.language),
            );
            Err(e.to_string())
        }
    }
}

#[command]
pub fn send_notification(app: AppHandle, params: NotificationParams) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&params.title)
        .body(&params.body)
        .icon(&params.icon)
        .show()
        .map_err(|e| format!("Failed to show notification: {}", e))?;
    Ok(())
}

#[command]
pub async fn update_theme_mode(app: AppHandle, mode: String) {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("pake") {
            let theme = if mode == "dark" {
                Theme::Dark
            } else {
                Theme::Light
            };
            let _ = window.set_theme(Some(theme));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = mode;
    }
}

#[command]
#[allow(unreachable_code)]
pub fn clear_cache_and_restart(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pake") {
        match window.clear_all_browsing_data() {
            Ok(_) => {
                // Clear all browsing data successfully
                app.restart();
                Ok(())
            }
            Err(e) => {
                eprintln!("Failed to clear browsing data: {}", e);
                Err(format!("Failed to clear browsing data: {}", e))
            }
        }
    } else {
        Err("Main window not found".to_string())
    }
}
