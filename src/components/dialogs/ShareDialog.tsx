'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Shuffle, Share } from 'lucide-react';
import { createShareUrl } from '@/lib/project/share';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { Cover } from '@/components/common/Cover';
import { ui, useUi } from '@/lib/store/ui';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

function CoverEditor() {
  const name = useStudio((s) => s.project.name);
  const meta = useStudio((s) => s.project.meta);
  return (
    <div className="border-line mb-4 flex gap-3 border-b pb-4">
      <Cover seed={meta.coverSeed} title={name} artist={meta.artist} styles={meta.styles} size={112} text />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">Artist</span>
          <input
            key={meta.artist}
            defaultValue={meta.artist}
            maxLength={80}
            placeholder="Your artist name"
            onBlur={(e) => e.target.value !== meta.artist && actions.setMeta({ artist: e.target.value.trim() })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="border-line bg-surface-2 focus:border-line-strong h-8 rounded-lg border px-2 text-sm outline-none"
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          icon={<Shuffle />}
          className="self-start"
          onClick={() => actions.setMeta({ coverSeed: Math.floor(Math.random() * 2 ** 31) })}
        >
          New cover
        </Button>
        <p className="text-fg-subtle text-[11px]">The cover shows in your library, the player and video exports.</p>
      </div>
    </div>
  );
}

export function ShareDialog() {
  const open = useUi((s) => s.dialog === 'share');
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when reopened
    setUrl(null);
    setCopied(false);
    setError(false);
    createShareUrl(getProject(), window.location.href)
      .then((link) => !cancelled && setUrl(link))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      ui.toast('Copy failed. Select the link and copy it manually.', 'error');
    }
  };

  const hasSamples = useStudio((s) => s.project.tracks.some((t) => t.sample));
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <Dialog
      open={open}
      onClose={ui.closeDialog}
      title="Share this beat"
      description="The whole beat is packed into the link. Nothing is uploaded, and whoever opens it gets their own copy to remix."
      size="sm"
      footer={
        <>
          {canShare && url && (
            <Button
              variant="ghost"
              icon={<Share />}
              onClick={() => navigator.share({ title: getProject().name, url }).catch(() => undefined)}
            >
              Share…
            </Button>
          )}
          <Button variant="primary" icon={copied ? <Check /> : <Copy />} onClick={copy} disabled={!url}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </>
      }
    >
      <CoverEditor />
      {error ? (
        <p className="text-danger text-sm">
          This browser can&apos;t create share links. Try downloading the project from the library instead.
        </p>
      ) : (
        <>
          <textarea
            readOnly
            aria-label="Share link"
            value={url ?? 'Creating link…'}
            onFocus={(e) => e.currentTarget.select()}
            rows={4}
            className="border-line bg-surface-2 text-fg-muted focus:border-line-strong w-full resize-none rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed break-all outline-none"
          />
          {url && <p className="text-fg-subtle mt-1.5 text-xs">{url.length.toLocaleString()} characters</p>}
          {hasSamples && (
            <p className="text-warn mt-2 text-xs">
              Uploaded samples are too big for a link. To share them too, download the beat from your library and send
              the file.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
