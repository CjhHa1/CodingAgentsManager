"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./Conversation";
import { Message, MessageContent } from "./Message";
import { MessageResponse } from "./MessageResponse";
import { ChatInput } from "./ChatInput";

import { getWebSocketUrl } from "@/lib/ws-url";
import type { ToolType } from "@/lib/terminal-types";
import { toolThemes } from "@/lib/terminal-types";
import type { AgentInfo } from "@/api/agents";

/** Max number of previous messages to include as context (client-side context memory). */
const CONTEXT_MESSAGE_LIMIT = 20;

function buildPromptWithContext(messages: ChatMessage[], newUserMessage: string): string {
  if (messages.length === 0) return newUserMessage;
  const recent = messages.slice(-CONTEXT_MESSAGE_LIMIT);
  const lines = recent.map((m) => (m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`));
  return `Previous conversation:\n\n${lines.join("\n\n")}\n\nUser: ${newUserMessage}`;
}

/** Map agent id to ToolType for theming. Falls back to "generic". */
function agentIdToToolType(id: string): ToolType {
  if (id in toolThemes) return id as ToolType;
  return "generic";
}

/** Capitalize first letter. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type ChatMessage = { role: "user" | "assistant"; content: string; progress?: string };

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);

  // Agent state
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [currentAgent, setCurrentAgent] = useState<string>("claude");
  const wsRef = useRef<WebSocket | null>(null);

  // Working directory
  const [cwd, setCwd] = useState<string>("");
  const [activeCwd, setActiveCwd] = useState<string>("");
  const [sttAvailable, setSttAvailable] = useState<boolean>(false);

  const toolType = agentIdToToolType(currentAgent);
  const agentLabel = capitalize(currentAgent);

  // Connect on mount, close on unmount
  useEffect(() => {
    const url = getWebSocketUrl("/ws/chat") + (cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : "");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
    };
    ws.onerror = () => setConnected(false);

    // Keepalive: send ping every 25s to prevent proxy idle timeout
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const s = event.data as string;

      let j: Record<string, unknown>;
      try {
        j = JSON.parse(s);
      } catch {
        appendToAssistant(s);
        return;
      }

      // {"type":"config","agents":[...],"default_agent":"claude","cwd":"..."} — agent config push on connect
      if (j.type === "config" && Array.isArray(j.agents)) {
        setAgents(j.agents as AgentInfo[]);
        if (typeof j.default_agent === "string") {
          setCurrentAgent(j.default_agent as string);
        }
        if (typeof j.cwd === "string") {
          setActiveCwd(j.cwd);
        }
        if (typeof j.stt_available === "boolean") {
          setSttAvailable(j.stt_available);
        }
        return;
      }

      // {"type":"agent_switched","agent":"opencode"} — backend confirmed agent switch
      if (j.type === "agent_switched" && typeof j.agent === "string") {
        setCurrentAgent(j.agent as string);
        return;
      }

      // {"done":true} — stream finished
      if (j.done === true) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.progress) {
            const next = [...prev];
            next[next.length - 1] = { ...last, progress: undefined };
            return next;
          }
          return prev;
        });
        setStreaming(false);
        return;
      }

      // {"error":"..."} — error
      if (typeof j.error === "string") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            const next = [...prev];
            next[next.length - 1] = {
              ...last,
              content: last.content + (last.content ? "\n\n" : "") + `Error: ${j.error}`,
              progress: undefined,
            };
            return next;
          }
          return [...prev, { role: "assistant", content: `Error: ${j.error}` }];
        });
        setStreaming(false);
        return;
      }

      // {"progress":"Thinking..."} — progress indicator
      if (typeof j.progress === "string") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            const next = [...prev];
            next[next.length - 1] = { ...last, progress: j.progress as string };
            return next;
          }
          return prev;
        });
        return;
      }

      // {"text":"..."} — text content to append
      if (typeof j.text === "string") {
        appendToAssistant(j.text as string);
        return;
      }
    };

    function appendToAssistant(text: string) {
      if (!text) return;
      setMessages((prev) => {
        if (prev.length === 0) return [{ role: "assistant", content: text }];
        const last = prev[prev.length - 1];
        if (last.role !== "assistant") {
          return [...prev, { role: "assistant", content: text }];
        }
        const next = [...prev];
        next[next.length - 1] = { ...last, content: last.content + text, progress: undefined };
        return next;
      });
    }

    return () => {
      clearInterval(pingInterval);
      ws.close();
      wsRef.current = null;
    };
  }, [cwd]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const prompt = buildPromptWithContext(messages, text);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    setStreaming(true);
    wsRef.current.send(prompt);
  }, [input, messages]);

  const handleAgentChange = useCallback((agentId: string) => {
    if (agentId === currentAgent) return;
    setCurrentAgent(agentId);
    // Send /cli_<agent> command to switch backend
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(`/cli_${agentId}`);
    }
  }, [currentAgent]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title={`Chat with ${agentLabel}`}
              description="Send a message to start."
            />
          ) : (
            messages.map((msg, i) => (
              <Message key={i} from={msg.role}>
                <MessageContent
                  className={
                    msg.role === "user"
                      ? "rounded-lg bg-primary/15 px-4 py-3 text-foreground"
                      : "rounded-lg bg-muted/50 px-4 py-3 text-foreground"
                  }
                >
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  ) : (
                    <>
                      <MessageResponse
                        content={msg.content}
                        isStreaming={streaming && i === messages.length - 1}
                      />
                      {msg.progress && (
                        <span className="text-xs text-muted-foreground/60 font-mono animate-pulse">
                          {msg.progress}
                        </span>
                      )}
                    </>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t border-border/40 px-4 py-2 flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">cwd</span>
        <input
          type="text"
          value={connected ? activeCwd : cwd}
          onChange={(e) => !connected && setCwd(e.target.value)}
          readOnly={connected}
          placeholder="Default working directory"
          title={connected ? "Click disconnect to change working directory" : "Working directory for agent (absolute path)"}
          className="flex-1 min-w-0 bg-transparent text-[11px] font-mono text-foreground/70 placeholder:text-muted-foreground/30 outline-none border-0 truncate data-[editable=true]:cursor-text data-[editable=false]:cursor-default"
          data-editable={!connected}
        />
        <button
          type="button"
          onClick={() => {
            if (connected) {
              wsRef.current?.close();
            }
          }}
          title={connected ? "Disconnect to change working directory" : ""}
          className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
            connected
              ? "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
              : "text-muted-foreground/20 cursor-default pointer-events-none"
          }`}
        >
          {connected ? "disconnect" : "disconnected"}
        </button>
      </div>
      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={sendMessage}
        disabled={!connected}
        isStreaming={streaming}
        placeholder={connected ? `Message ${agentLabel}…` : "Connecting…"}
        targetLabel={agentLabel}
        targetTool={toolType}
        agents={agents}
        onAgentChange={handleAgentChange}
        sttAvailable={sttAvailable}
      />
    </div>
  );
}
