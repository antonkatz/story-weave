import { useEffect, useRef, useState } from "react";
import { Mic, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

type ProfileMap = Record<string, { display_name: string; avatar_url: string | null }>;

type Message = {
  id: string;
  author_id: string;
  kind: "text" | "voice";
  body: string;
  audio_path: string | null;
  transcript: string | null;
  created_at: string;
};

export function Conversation({ bookId }: { bookId: string }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial fetch
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id,author_id,kind,body,audio_path,transcript,created_at")
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

  const uploadVoice = async (blob: Blob) => {
    if (!user) return;
    const path = `${bookId}/${user.id}-${Date.now()}.webm`;
    const { error: upErr } = await supabase.storage
      .from("voice-messages")
      .upload(path, blob, { contentType: "audio/webm" });
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
          <Button
            size="icon"
            variant={recording ? "destructive" : "secondary"}
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? "Stop recording" : "Record voice"}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isMine,
  authorName,
}: {
  message: Message;
  isMine: boolean;
  authorName: string;
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
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm ${
          isMine
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        }`}
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
    </div>
  );
}
