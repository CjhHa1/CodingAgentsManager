//! Telegram receiver: long polling for incoming messages, bot lifecycle.

use std::sync::Arc;

use dashmap::DashMap;
use teloxide::prelude::*;
use tokio::sync::mpsc;

use super::transport::TelegramTransport;
use crate::im::daemon::OutboundMsg;
use crate::im::log::{prefix_channel, truncate_content_default};

const TELEGRAM_API_GET_ME: &str = "https://api.telegram.org/bot";

/// Run the Telegram receiver (long polling). Pushes InboundMessage to inbound_tx when the
/// chat is not busy; pushes "Please wait..." to outbound when busy.
pub async fn run_telegram_receiver(
    bot: Bot,
    inbound_tx: mpsc::Sender<crate::im::worker::InboundMessage>,
    outbound: Arc<crate::im::daemon::OutboundHub<TelegramTransport>>,
    busy_set: Arc<DashMap<String, ()>>,
) {
    let outbound = outbound.clone();
    teloxide::repl(bot, move |bot: Bot, msg: Message| {
        let inbound_tx = inbound_tx.clone();
        let outbound = outbound.clone();
        let busy_set = busy_set.clone();

        async move {
            let chat_id = msg.chat.id;
            let channel_id = format!("telegram:{}", chat_id.0);
            let user_log = format_user(&msg);
            let user_message_id = Some(msg.id.0.to_string());

            let text = match msg.text() {
                Some(t) => t.trim().to_string(),
                None => {
                    eprintln!("{} chat_id={} from={} direction=incoming content=(non-text, ignored)",
                        prefix_channel("telegram"), chat_id.0, user_log);
                    let _ = outbound.send(&channel_id, OutboundMsg::Send(
                        channel_id.clone(), "Send me a text message.".to_string())).await;
                    return Ok(());
                }
            };
            if text.is_empty() {
                eprintln!("{} chat_id={} from={} direction=incoming content=(empty)",
                    prefix_channel("telegram"), chat_id.0, user_log);
                let _ = outbound.send(&channel_id, OutboundMsg::Send(
                    channel_id.clone(), "Send me a non-empty message.".to_string())).await;
                return Ok(());
            }

            eprintln!("{} chat_id={} from={} direction=incoming content={}",
                prefix_channel("telegram"), chat_id.0, user_log, truncate_content_default(&text));

            let _ = bot.send_chat_action(chat_id, teloxide::types::ChatAction::Typing).await;

            if busy_set.contains_key(&channel_id) {
                let _ = outbound.send(&channel_id, OutboundMsg::Send(
                    channel_id.clone(), "Please wait for the current task to finish.".to_string())).await;
                return Ok(());
            }

            let _ = inbound_tx.send(crate::im::worker::InboundMessage {
                channel_id,
                text,
                attachments: vec![],
                parent_id: None,
                user_message_id,
            }).await;
            Ok(())
        }
    })
    .await;
}

fn format_user(msg: &Message) -> String {
    msg.from
        .as_ref()
        .map(|u| {
            u.username.as_ref()
                .map(|s| format!("@{}", s))
                .unwrap_or_else(|| u.first_name.clone())
        })
        .unwrap_or_else(|| "?".to_string())
}

/// Pre-check Telegram API (getMe). Returns Ok(()) if reachable and token valid.
async fn check_telegram_api(token: &str) -> Result<(), String> {
    let url = format!("{}{}/getMe", TELEGRAM_API_GET_ME, token);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("reqwest client: {}", e))?;
    let res = client.get(&url).send().await
        .map_err(|e| format!("Telegram API unreachable: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("getMe returned status {}", res.status()));
    }
    let body = res.text().await.map_err(|e| format!("read body: {}", e))?;
    if body.trim().is_empty() {
        return Err("getMe returned empty body (API may be blocked or proxy needed)".to_string());
    }
    let _: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| format!("getMe invalid JSON (raw: {} bytes)", body.len()))?;
    Ok(())
}

/// Run the Telegram bot: create channels, spawn send daemon and worker, then run the receiver.
/// No-op if telegram.bot_token not set in settings.json.
pub async fn run_telegram_bot() {
    let config = crate::config::ensure_loaded();
    let token = match config.telegram_bot_token.as_deref() {
        Some(t) if !t.trim().is_empty() => t.to_string(),
        _ => {
            eprintln!("{} config=missing bot_token disabled", prefix_channel("telegram"));
            return;
        }
    };

    if let Err(e) = check_telegram_api(&token).await {
        eprintln!("{} config=API check failed error={} (set HTTPS_PROXY if blocked)",
            prefix_channel("telegram"), e);
        return;
    }

    let bot = Bot::new(&token);

    match bot.get_me().await {
        Ok(me) => {
            let name = me.user.username.as_deref().unwrap_or("(no username)");
            eprintln!("{} event=bot_started bot=@{}", prefix_channel("telegram"), name);
        }
        Err(e) => {
            eprintln!("{} config=get_me failed error={}", prefix_channel("telegram"), e);
            return;
        }
    }

    let (inbound_tx, inbound_rx) = mpsc::channel(64);
    let busy_set: Arc<DashMap<String, ()>> = Arc::new(DashMap::new());
    let transport = Arc::new(TelegramTransport::new(bot.clone()));
    let outbound = crate::im::daemon::OutboundHub::new(transport);

    tokio::spawn(crate::im::worker::run_worker(
        inbound_rx,
        outbound.clone(),
        busy_set.clone(),
        None,
        config.telegram_verbose.clone(),
    ));

    run_telegram_receiver(bot, inbound_tx, outbound, busy_set).await;
}
