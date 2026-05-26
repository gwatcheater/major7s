import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, ImagePlus, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tournament/$id/blog/new")({
  component: NewBlogPost,
});

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function NewBlogPost() {
  const { id } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const { data: tournament } = useQuery({
    queryKey: ["tournament", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tournaments").select("id, name").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isAdmin) {
    return (
      <div className="p-8 md:p-12 max-w-2xl mx-auto">
        <Link to="/tournament/$id" params={{ id }} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Tournament
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">Only admins can create blog posts.</p>
      </div>
    );
  }

  function onPickFile(f: File | null) {
    if (!f) { setFile(null); setPreview(null); return; }
    if (!ACCEPTED.includes(f.type)) { toast.error("Use a JPG, PNG, WebP or GIF image"); return; }
    if (f.size > MAX_BYTES) { toast.error("Image must be under 5 MB"); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function publish() {
    if (!user) return;
    if (!title.trim()) { toast.error("Enter a title"); return; }
    setSaving(true);

    let image_url: string | null = null;

    // Step one: upload image to the blog-images bucket, if one was chosen.
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("blog-images")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) { setSaving(false); toast.error(`Image upload failed: ${upErr.message}`); return; }
      const { data: pub } = supabase.storage.from("blog-images").getPublicUrl(path);
      image_url = pub.publicUrl;
    }

    // Step two: insert the post.
    const { error: insErr } = await supabase.from("blog_posts").insert({
      author_id: user.id,
      tournament_id: id,
      title: title.trim(),
      body: body.trim(),
      image_url,
    });
    if (insErr) { setSaving(false); toast.error(`Could not publish: ${insErr.message}`); return; }

    setSaving(false);
    toast.success("Blog post published");
    navigate({ to: "/tournament/$id", params: { id } });
  }

  return (
    <div className="p-4 md:p-12 max-w-2xl mx-auto">
      <Link to="/tournament/$id" params={{ id }} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" /> {tournament?.name ?? "Tournament"}
      </Link>

      <header className="mt-4 mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>New Post</p>
        <h1 className="font-display text-3xl md:text-4xl uppercase mt-1">Write Blog Entry</h1>
      </header>

      <Card className="p-5 md:p-6 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title" />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your post…"
            rows={10}
            className="w-full px-3 py-2.5 border border-input bg-white text-sm rounded-sm focus:outline-none focus:border-primary resize-y"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5">Image (optional)</label>
          {preview ? (
            <div className="relative inline-block">
              <img src={preview} alt="Preview" className="max-h-64 rounded-md border border-border" />
              <button
                type="button"
                onClick={() => onPickFile(null)}
                className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80"
                title="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-input rounded-md p-8 cursor-pointer hover:bg-muted/40 transition-colors">
              <ImagePlus className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to choose an image</span>
              <span className="text-[11px] text-muted-foreground">JPG, PNG, WebP or GIF · max 5 MB</span>
              <input
                type="file"
                accept={ACCEPTED.join(",")}
                className="hidden"
                onChange={(e) => { onPickFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
              />
            </label>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={publish} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Publish Post
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/tournament/$id", params: { id } })} disabled={saving}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
