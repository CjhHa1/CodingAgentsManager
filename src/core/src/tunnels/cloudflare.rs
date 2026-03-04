//! Cloudflare Tunnel: expose the web dashboard via `cloudflared tunnel run --token <TOKEN>`.
//! The public URL is configured in Cloudflare Dashboard (Public Hostname), so we read it from
//! settings.json `tunnel.cloudflare.hostname` instead of parsing stdout.

use std::process::Stdio;
use tokio::process::Command;

/// Start Cloudflare tunnel. Returns (guard, public URL).
/// Token from config; hostname (public URL) from config since Cloudflare Named Tunnels have a fixed URL.
pub async fn start_web_tunnel(
    config: &crate::config::Config,
) -> Result<(super::TunnelGuard, String), Box<dyn std::error::Error + Send + Sync>> {
    let token = config.cloudflare_tunnel_token.as_deref().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "cloudflare token not set: set tunnel.cloudflare.tunnel_token in settings.json",
        )
    })?;

    let hostname = config.cloudflare_hostname.as_deref().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "cloudflare hostname not set: set tunnel.cloudflare.hostname in settings.json (e.g. vibe.yourdomain.com)",
        )
    })?;

    let mut cmd = Command::new("cloudflared");
    cmd.args(["tunnel", "run", "--token", token])
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());

    let child = cmd.spawn().map_err(|e| {
        format!("Failed to spawn cloudflared (is it installed? brew install cloudflared): {}", e)
    })?;

    let url = format!(
        "https://{}",
        hostname
            .trim_start_matches("https://")
            .trim_start_matches("http://")
    );
    eprintln!("[cloudflare] Tunnel starting, public URL: {}", url);

    Ok((super::TunnelGuard::Process(child), url))
}

/// Cloudflare backend. Implements TunnelBackend for unified dispatch.
pub struct CloudflareBackend;

#[async_trait::async_trait]
impl crate::tunnels::TunnelBackend for CloudflareBackend {
    fn name(&self) -> &'static str {
        "cloudflare"
    }

    async fn start_web_tunnel(
        &self,
        config: &crate::config::Config,
    ) -> Result<(super::TunnelGuard, String), Box<dyn std::error::Error + Send + Sync>> {
        start_web_tunnel(config).await
    }
}
