# CLAUDE.md — VibeAround

## Project Overview

VibeAround is an ambient vibe coding partner. It exposes two interaction surfaces:
1. **Browser-based remote terminal** — PTY sessions via WebSocket + xterm.js
2. **IM bots** — Telegram (long polling) and Feishu (webhook) for conversational agent control

All four AI agents (Claude Code, Gemini CLI, OpenCode, Codex) are connected through the **Agent Client Protocol (ACP)**.

---

## Architecture

```
Frontend (React/Vite)          IM Channels
  Web Dashboard                  Telegram (long polling)
  Desktop Tray (Tauri)           Feishu (webhook + card callbacks)
       │                               │
       │ WebSocket / HTTP              │ InboundMessage
       ▼                               ▼
  HTTP Server (Axum)          IM Worker (im/worker.rs)
  ws://.../ws/pty              └─ parse /help /start /cli_<agent>
  ws://.../ws/chat             └─ lazy-start default agent
       │                       └─ send_message → AgentBackend
       ▼                               │
  Session Registry                     │ AgentEvent stream
  (session.rs, DashMap)                ▼
  └─ PTY Bridge (pty.rs)       OutboundHub (im/daemon.rs)
     └─ portable-pty           └─ per-channel FIFO queue
     └─ circular buffer 2MiB   └─ rate limiting (1s MIN_INTERVAL)
     └─ broadcast channel      └─ stream-edit throttling
                                └─ ImTransport (send/edit/reply/react)
                                       │
                               ┌───────┴───────┐
                          TelegramTransport  FeishuTransport
                          (teloxide)         (HTTP API)
```

### Agent Backend (agent/mod.rs)

All agents use a unified `AcpBackend` that runs on a dedicated thread with single-threaded tokio + LocalSet:

| Agent | Connection method |
|-------|------------------|
| Claude | In-process duplex pipe → `claude_acp` adapter → `ClaudeSdk` → `claude` CLI |
| Gemini | Subprocess stdio → `gemini --experimental-acp` |
| OpenCode | Subprocess stdio → `opencode acp` |
| Codex | Subprocess stdio → `npx @zed-industries/codex-acp` |

**Permission model:** `SharedAcpClientHandler::request_permission()` auto-selects the first option — all tool calls are auto-approved.

---

## Configuration (src/settings.json)

Config is loaded once at startup from `src/settings.json` (relative to `src/core/Cargo.toml`'s parent, i.e. `src/`).

```json
{
  "working_dir": "/absolute/path/to/workspace",
  "default_agent": "claude",
  "enabled_agents": ["claude", "gemini", "opencode", "codex"],
  "tmux": {
    "detach_others": true
  },
  "tunnel": {
    "provider": "ngrok",
    "ngrok": {
      "auth_token": "...",
      "domain": "optional-static-domain.ngrok-free.app"
    },
    "cloudflare": {
      "tunnel_token": "...",
      "hostname": "vibe.yourdomain.com"
    }
  },
  "channels": {
    "telegram": {
      "bot_token": "...",
      "verbose": {
        "show_thinking": false,
        "show_tool_use": false
      }
    },
    "feishu": {
      "app_id": "...",
      "app_secret": "...",
      "verbose": {
        "show_thinking": false,
        "show_tool_use": false
      }
    }
  }
}
```

**Defaults:**
- `working_dir`: `~/VibeAround`
- `default_agent`: `"claude"`
- `enabled_agents`: all four agents
- `tmux.detach_others`: `true`
- `tunnel.provider`: localtunnel (fallback)
- `verbose.*`: both `false`

---

## Key Source Files

| File | Responsibility |
|------|---------------|
| `src/core/src/config.rs` | Config singleton, loads `settings.json` |
| `src/core/src/agent/mod.rs` | `AgentBackend` trait, `AcpBackend`, `SharedAcpClientHandler` |
| `src/core/src/agent/claude_acp.rs` | Claude ACP adapter (in-process duplex bridge) |
| `src/core/src/agent/claude_sdk.rs` | Claude CLI subprocess management |
| `src/core/src/pty.rs` | PTY spawn, OSC color responder, resize, state polling |
| `src/core/src/session.rs` | Session registry (DashMap), circular buffer, broadcast |
| `src/core/src/im/worker.rs` | IM message dispatch, agent lifecycle, event streaming |
| `src/core/src/im/daemon.rs` | OutboundHub, per-channel send daemon, rate limiting |
| `src/core/src/im/transport.rs` | `ImTransport` trait, `ImChannelCapabilities` |
| `src/core/src/im/channels/telegram/` | Telegram long polling receiver + transport |
| `src/core/src/im/channels/feishu/` | Feishu webhook handler + transport + card callbacks |
| `src/core/src/tunnels.rs` | Tunnel provider enum + dispatch |
| `src/core/src/headless.rs` | Headless runner for web chat and IM |

---

## IM Commands

| Command | Effect |
|---------|--------|
| `/start` | Show interactive agent picker card |
| `/help` | Show all commands |
| `/cli_claude` | Switch to Claude Code |
| `/cli_gemini` | Switch to Gemini CLI |
| `/cli_opencode` | Switch to OpenCode |
| `/cli_codex` | Switch to Codex |

---

## Build & Dev

```bash
cd src
bun install
bun run prebuild
bun run dev        # development mode (tray + web)
cargo build --release   # Rust core only
cargo test              # Rust tests
```

Config file: `src/settings.json` (create from scratch, no example file committed).

---

## Current Limitations / Roadmap Items

- No voice/audio input support
- No workspace switching via IM
- No persistent conversation history (SQLite schema exists in `db.rs` but unused)
- No multi-account IM binding
- No agent model/API key configuration per agent
- Telegram: non-text messages (voice, photo, etc.) are rejected with "Send me a text message"
- Feishu: supports file and image attachments (forwarded as text description to agent)
