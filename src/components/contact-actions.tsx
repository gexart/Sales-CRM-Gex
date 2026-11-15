// Click-to-call and WhatsApp for phone numbers, and "Share on WhatsApp" for generated documents.
// Documents are private (behind login), so they are never turned into public links: the phone's own share sheet
// attaches the real file, and where that is not available the file is downloaded and WhatsApp opens with the message.
import type { MouseEvent } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { Button, cn, useToast } from "./ui";
import { hasDigits, telHref, waHref } from "../lib/contact-links";

const stop = (e: MouseEvent) => e.stopPropagation(); // keep a tap on the number from opening the record row behind it
const icon = "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-slate-600 transition-colors hover:bg-slate-100 hover:text-ink active:bg-slate-200";

/** The number itself (tap to call) plus call and WhatsApp buttons. */
export function PhoneActions({ phone, greeting, className }: { phone: string; greeting?: string; className?: string }) {
  if (!hasDigits(phone)) return <>{phone}</>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <a href={telHref(phone)} onClick={stop} className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">
        {phone}
      </a>
      <a href={telHref(phone)} onClick={stop} aria-label={`Call ${phone}`} title="Call" className={icon}>
        <Phone className="size-3.5" />
      </a>
      <a href={waHref(phone, greeting)} onClick={stop} target="_blank" rel="noreferrer noopener" aria-label={`WhatsApp ${phone}`} title="WhatsApp" className={cn(icon, "text-emerald-600")}>
        <MessageCircle className="size-3.5" />
      </a>
    </span>
  );
}

/** Shares a file through the phone's share sheet (WhatsApp appears in it). Falls back to download + WhatsApp message. */
export async function shareFile(o: { url: string; fileName: string; mime: string; text: string }): Promise<"shared" | "fallback"> {
  try {
    const res = await fetch(o.url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const file = new File([await res.blob()], o.fileName, { type: o.mime });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: o.text });
      return "shared";
    }
    // Desktop browsers: hand the user the file, then open WhatsApp with the message ready.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = o.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch (e) {
    if ((e as Error).name === "AbortError") return "shared"; // the user closed the share sheet
    throw e;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(o.text)}`, "_blank", "noopener");
  return "fallback";
}

export function ShareWhatsApp({ url, fileName, mime = "application/pdf", text, label = "Share on WhatsApp", size = "md" }: { url: string; fileName: string; mime?: string; text: string; label?: string; size?: "sm" | "md" }) {
  const toast = useToast();
  return (
    <Button
      size={size}
      icon={MessageCircle}
      onClick={async () => {
        try {
          const r = await shareFile({ url, fileName, mime, text });
          if (r === "fallback") toast("info", "The file was downloaded. Attach it in the WhatsApp chat that just opened.");
        } catch (e) {
          toast("error", (e as Error).message || "Could not share the file");
        }
      }}
    >
      {label}
    </Button>
  );
}
