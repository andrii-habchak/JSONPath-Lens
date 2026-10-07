import type { AriaRole, ComponentChildren, TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Browsers cap element height (~33.5M px in Chrome); stay well below it. */
const MAX_SCROLL_PX = 8_000_000;

export interface ScrollRequest {
  index: number;
  /** Changes on every request so the same index can be scrolled to twice. */
  nonce: number;
  /** 'auto' only scrolls when the row is outside the viewport. */
  align?: 'auto' | 'center' | 'start';
}

interface Props {
  count: number;
  rowHeight: number;
  renderRow: (index: number) => ComponentChildren;
  /** Called with the rendered range [start, end) whenever it changes. */
  onRange?: (start: number, end: number) => void;
  scrollTo?: ScrollRequest | null;
  overscan?: number;
  className?: string;
  tabIndex?: number;
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLDivElement>) => void;
  ariaLabel?: string;
  role?: AriaRole;
}

/**
 * Fixed-row-height virtual list that also works for millions of rows: when the
 * full height would exceed MAX_SCROLL_PX, scroll positions are scaled.
 */
export function VirtualList(props: Props) {
  const { count, rowHeight, overscan = 12 } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  const fullPx = count * rowHeight;
  const spacerPx = Math.min(fullPx, MAX_SCROLL_PX);
  // Ratio between virtual offset and real scrollTop.
  const scale = fullPx > MAX_SCROLL_PX && spacerPx > height ? (fullPx - height) / (spacerPx - height) : 1;

  const virtualTop = Math.min(scrollTop * scale, Math.max(0, fullPx - height));
  const first = Math.floor(virtualTop / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, Math.ceil((virtualTop + height) / rowHeight) + overscan);
  const offsetY = scrollTop + (start * rowHeight - virtualTop);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight || 600));
    ro.observe(el);
    setHeight(el.clientHeight || 600);
    return () => ro.disconnect();
  }, []);

  // Clamp when the list shrinks.
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollTop > spacerPx) {
      el.scrollTop = Math.max(0, spacerPx - height);
      setScrollTop(el.scrollTop);
    }
  }, [spacerPx, height]);

  // With scaled scrolling a wheel tick would skip rows: scroll by the
  // unscaled distance instead (accumulating sub-pixel remainders).
  useEffect(() => {
    const el = ref.current;
    if (!el || scale <= 1) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? rowHeight : e.deltaMode === 2 ? el.clientHeight : 1;
      acc += (e.deltaY * unit) / scale;
      const whole = Math.trunc(acc);
      if (whole !== 0) {
        acc -= whole;
        el.scrollTop += whole;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, rowHeight]);

  const { onRange } = props;
  useEffect(() => {
    onRange?.(start, end);
  }, [start, end, count, onRange]);

  const scrollToIndex = useCallback(
    (index: number, align: 'auto' | 'center' | 'start' = 'auto') => {
      const el = ref.current;
      if (!el || index < 0) return;
      const rowTop = index * rowHeight;
      const curTop = el.scrollTop * scale;
      if (align === 'auto' && rowTop >= curTop && rowTop + rowHeight <= curTop + el.clientHeight) return;
      let target = rowTop;
      if (align === 'center' || align === 'auto') target = rowTop - el.clientHeight / 3;
      target = Math.max(0, Math.min(target, fullPx - el.clientHeight));
      el.scrollTop = target / scale;
      setScrollTop(el.scrollTop);
    },
    [rowHeight, scale, fullPx],
  );

  const req = props.scrollTo;
  useEffect(() => {
    if (req) scrollToIndex(req.index, req.align);
  }, [req?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: ComponentChildren[] = [];
  for (let i = start; i < end; i++) items.push(props.renderRow(i));

  return (
    <div
      ref={ref}
      class={'vlist ' + (props.className ?? '')}
      tabIndex={props.tabIndex}
      onKeyDown={props.onKeyDown}
      role={props.role}
      aria-label={props.ariaLabel}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
    >
      <div class="vlist-spacer" style={{ height: `${spacerPx}px` }} />
      <div class="vlist-window" style={{ transform: `translateY(${offsetY}px)` }}>
        {items}
      </div>
    </div>
  );
}
