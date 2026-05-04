import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send, Square, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { SuggestedEdits } from "@/components/book/SuggestedEdits";

type ProfileMap = Record<string, { display_name: string; avatar_url: string | null }>;

type Message = {
  id: string;
  author_id: string;
  kind: "text" | "voice";
  body: string;
  audio_path: string | null;
  transcript: string | null;
  created_at: string;
  analyzed_at: string | null;
};

type AgentKind = "structure" | "quotation" | "writing" | "splitter";

export function Conversation({
  bookId,
  jumpToMessageId,
  onApplied,
}: {
  bookId: string;
  jumpToMessageId?: string | null;
  onApplied?: (target: { chapterId: string; sectionId: string | null }) => void;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState<string | null>(null); // `${messageId}:${agent}`
  const [runCounts, setRunCounts] = useState<Record<string, number>>({}); // key `${messageId}:${agent}` -> count
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial fetch
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id,author_id,kind,body,audio_path,transcript,created_at,analyzed_at")
        .eq("book_id", bookId)
        .order("created_at", { ascending: true });
      if (active) setMessages((data ?? []) as Message[]);
    })();
    return () => {
      active = false;
    };
  }, [bookId]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${bookId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `book_id=eq.${bookId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message])
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `book_id=eq.${bookId}` },
        (payload) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m))
          )
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookId]);

  // Load profiles for displayed authors
  useEffect(() => {
    const ids = Array.from(new Set(messages.map((m) => m.author_id))).filter(
      (id) => !(id in profiles)
    );
    if (ids.length === 0) return;
    supabase
      .from("profiles")
      .select("id,display_name,avatar_url")
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        setProfiles((prev) => {
          const next = { ...prev };
          for (const p of data) {
            next[p.id] = { display_name: p.display_name, avatar_url: p.avatar_url };
          }
          return next;
        });
      });
  }, [messages, profiles]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Jump-to-message: scroll specific message into view + brief highlight
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (!jumpToMessageId) return;
    const el = document.getElementById(`msg-${jumpToMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(jumpToMessageId);
      const t = setTimeout(() => setHighlightId(null), 2000);
      return () => clearTimeout(t);
    }
  }, [jumpToMessageId, messages.length]);

  const sendText = async () => {
    const body = text.trim();
    if (!body || !user) return;
    setText("");
    const { error } = await supabase.from("messages").insert({
      book_id: bookId,
      author_id: user.id,
      kind: "text",
      body,
    });
    if (error) toast.error("Could not send message");
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await uploadVoice(blob);
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      toast.error("Microphone access denied");
      console.error(err);
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const uploadVoice = async (blob: Blob, ext = "webm", contentType = "audio/webm") => {
    if (!user) return;
    const path = `${bookId}/${user.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("voice-messages")
      .upload(path, blob, { contentType });
    if (upErr) {
      toast.error("Could not upload voice message");
      return;
    }
    const { data: msg, error: insErr } = await supabase
      .from("messages")
      .insert({
        book_id: bookId,
        author_id: user.id,
        kind: "voice",
        body: "",
        audio_path: path,
      })
      .select("id")
      .single();
    if (insErr || !msg) {
      toast.error("Could not save voice message");
      return;
    }
    // Fire-and-forget transcription
    supabase.functions
      .invoke("transcribe-voice", { body: { messageId: msg.id, audioPath: path } })
      .catch((e) => console.error("transcription error", e));
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Please select an audio file");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Audio file must be 25MB or smaller");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
    setUploading(true);
    try {
      await uploadVoice(file, ext, file.type);
      toast.success("Audio uploaded");
    } finally {
      setUploading(false);
    }
  };

  // Load per-agent run counts
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("message_agent_analysis")
        .select("message_id,agent,run_count")
        .eq("book_id", bookId);
      if (!active || !data) return;
      const next: Record<string, number> = {};
      for (const r of data as { message_id: string; agent: AgentKind; run_count: number }[]) {
        next[`${r.message_id}:${r.agent}`] = r.run_count ?? 1;
      }
      setRunCounts(next);
    })();
    return () => {
      active = false;
    };
  }, [bookId]);

  // Realtime: track analysis rows
  useEffect(() => {
    const ch = supabase
      .channel(`analysis:${bookId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_agent_analysis", filter: `book_id=eq.${bookId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { message_id: string; agent: AgentKind; run_count?: number };
          if (!row?.message_id) return;
          setRunCounts((prev) => ({
            ...prev,
            [`${row.message_id}:${row.agent}`]: payload.eventType === "DELETE" ? 0 : row.run_count ?? 1,
          }));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [bookId]);

  const runAgentOnMessage = async (agent: AgentKind, messageId: string) => {
    const key = `${messageId}:${agent}`;
    setRunning(key);
    try {
      const { data, error } = await supabase.functions.invoke("run-agents", {
        body: { bookId, agent, messageId },
      });
      if (error) throw error;
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      const msg = (data as { message?: string })?.message;
      if (msg) toast.info(msg);
      else toast.success(`${capitalize(agent)} proposed ${inserted} edit${inserted === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run agent");
    } finally {
      setRunning(null);
    }
  };

  const agentList: { id: AgentKind; label: string }[] = [
    { id: "structure", label: "Structure" },
    { id: "splitter", label: "Splitter" },
    { id: "quotation", label: "Quotation" },
    { id: "writing", label: "Writing" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="mt-12 text-center text-sm italic text-muted-foreground">
            No messages yet — say hello or send a voice note.
          </p>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isMine={m.author_id === user?.id}
              authorName={profiles[m.author_id]?.display_name ?? "Co-author"}
              highlighted={m.id === highlightId}
              agents={agentList}
              runCounts={runCounts}
              running={running}
              onRunAgent={(agent) => runAgentOnMessage(agent, m.id)}
            />
          ))
        )}
      </div>
      <div className="border-t border-border bg-paper/60 p-3">
        <div className="flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
            placeholder={recording ? "Recording…" : "Write a message"}
            disabled={recording}
          />
          <Button size="icon" onClick={sendText} disabled={recording || !text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFilePick}
          />
          <Button
            size="icon"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={recording || uploading}
            aria-label="Upload audio file"
            title="Upload audio file"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant={recording ? "destructive" : "secondary"}
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? "Stop recording" : "Record voice"}
            disabled={uploading}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <SuggestedEdits bookId={bookId} onApplied={onApplied} />
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function MessageBubble({
  message,
  isMine,
  authorName,
  highlighted,
  agents,
  runCounts,
  running,
  onRunAgent,
}: {
  message: Message;
  isMine: boolean;
  authorName: string;
  highlighted?: boolean;
  agents: { id: AgentKind; label: string }[];
  runCounts: Record<string, number>;
  running: string | null;
  onRunAgent: (agent: AgentKind) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (message.kind !== "voice" || !message.audio_path) return;
    let active = true;
    supabase.storage
      .from("voice-messages")
      .createSignedUrl(message.audio_path, 60 * 60)
      .then(({ data }) => {
        if (active && data) setAudioUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [message]);

  return (
    <div id={`msg-${message.id}`} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm transition-all ${
          isMine
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        } ${highlighted ? "ring-2 ring-plum ring-offset-2 ring-offset-paper" : ""}`}
      >
        <p className={`mb-1 text-xs font-medium ${isMine ? "opacity-80" : "text-muted-foreground"}`}>
          {isMine ? "You" : authorName}
        </p>
        {message.kind === "text" ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
        ) : (
          <div className="space-y-2">
            {audioUrl ? (
              <audio controls src={audioUrl} className="w-64 max-w-full" />
            ) : (
              <p className="text-xs italic opacity-70">Loading audio…</p>
            )}
            <p className="text-xs italic leading-relaxed opacity-90">
              {message.transcript ?? "Transcribing…"}
            </p>
          </div>
        )}
      </div>
      <div className={`mt-1 flex flex-wrap gap-1 ${isMine ? "justify-end" : "justify-start"} max-w-[80%]`}>
        {agents.map((a) => {
          const key = `${message.id}:${a.id}`;
          const count = runCounts[key] ?? 0;
          const maxed = count >= 3;
          const isRunning = running === key;
          return (
            <Button
              key={a.id}
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={maxed || running !== null}
              onClick={() => onRunAgent(a.id)}
              title={maxed ? `${a.label} agent already ran 3 times` : `Run ${a.label} agent on this message`}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {isRunning ? `${a.label}…` : `${a.label}${count > 0 ? ` (${count}/3)` : ""}`}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
