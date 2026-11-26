'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Trash2 } from 'lucide-react';

const REVEAL = 64;
type Gesture = { x: number; y: number; base: number; offset: number; dragging: boolean };

export function SwipeCategory({
  name,
  canDelete,
  open,
  onOpenChange,
  onDelete,
  busy = false,
  children,
}: {
  name: string;
  canDelete: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const hintId = useId();
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange]);

  if (!canDelete) return <div className="category-row">{children}</div>;

  function start(event: PointerEvent<HTMLDivElement>) {
    if (busy || event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      base: open ? -REVEAL : 0,
      offset: open ? -REVEAL : 0,
      dragging: false,
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x,
      dy = event.clientY - g.y;
    if (!g.dragging) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < 8) return;
      // A closed row opens only when dragged to the left.
      if (g.base === 0 && dx >= 0) return;
      g.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      onOpenChange(true);
    }
    event.preventDefault();
    g.offset = Math.max(-REVEAL - 10, Math.min(0, g.base + dx));
    setOffset(g.offset);
  }
  function finish(cancelled = false) {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.dragging) return;
    suppressClick.current = true;
    setDragging(false);
    setOffset(0);
    onOpenChange(cancelled ? g.base < 0 : g.offset < -REVEAL * 0.45);
  }

  return (
    <div
      ref={root}
      className="swipe-category"
      data-open={open}
      data-dragging={dragging}
      role="group"
      aria-label={`Kategori ${name}`}
      aria-describedby={hintId}
      tabIndex={busy ? -1 : 0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onOpenChange(true);
        }
        if (event.key === 'ArrowRight' || event.key === 'Escape') {
          event.preventDefault();
          onOpenChange(false);
        }
      }}
    >
      <span className="sr-only" id={hintId}>
        Geser ke kiri atau tekan panah kiri untuk membuka tombol hapus. Panah kanan atau Escape
        untuk menutup.
      </span>
      {(open || (dragging && offset < 0)) && (
        <div className="category-delete-action" aria-hidden={!open}>
          <button
            type="button"
            disabled={busy}
            tabIndex={open ? 0 : -1}
            aria-label={`Hapus ${name}`}
            onClick={onDelete}
          >
            <Trash2 size={18} />
          </button>
        </div>
      )}
      <div
        className="category-row swipe-surface"
        style={{ '--swipe-x': `${dragging ? offset : open ? -REVEAL : 0}px` } as CSSProperties}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish(true)}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            return;
          }
          if (open) onOpenChange(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
