import { useCallback, useEffect, useState, type RefObject } from "react";

// Zoom/pan is a pure VIEW transform: `zoom` is a plain multiplier on the
// stage's natural (base) pixel size, `panX`/`panY` are the stage's
// translated top-left offset within the viewport, both in CSS pixels.
// Row geometry itself never changes — see row-stage.tsx's docstring for
// why the existing draw/move/resize math needs no changes to stay correct
// under this transform.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

interface ZoomPanState {
  zoom: number;
  panX: number;
  panY: number;
}

// Takes the viewport ref rather than creating and returning its own — the
// returned object is otherwise plain state/functions, and mixing a ref
// into that trips the stricter "don't read a ref during render" lint rule
// at every call site that touches an unrelated field on the same object.
export function useZoomPan(
  viewportRef: RefObject<HTMLDivElement | null>,
  baseWidth: number,
  baseHeight: number
) {
  const [state, setState] = useState<ZoomPanState>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || baseWidth <= 0 || baseHeight <= 0) return;
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const scale = clampZoom(
      Math.min(rect.width / baseWidth, rect.height / baseHeight) * 0.96
    );
    setState({
      zoom: scale,
      panX: (rect.width - baseWidth * scale) / 2,
      panY: (rect.height - baseHeight * scale) / 2,
    });
  }, [viewportRef, baseWidth, baseHeight]);

  // Re-fit whenever the drawing itself changes (new page, dimensions now
  // known) — a fresh page should open showing the whole drawing, not
  // wherever the previous page's zoom/pan happened to be.
  useEffect(() => {
    fit();
  }, [fit]);

  const zoomToward = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      setState((prev) => {
        const newZoom = clampZoom(prev.zoom * factor);
        const ratio = newZoom / prev.zoom;
        return {
          zoom: newZoom,
          panX: relX - (relX - prev.panX) * ratio,
          panY: relY - (relY - prev.panY) * ratio,
        };
      });
    },
    [viewportRef]
  );

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      zoomToward(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        factor
      );
    },
    [viewportRef, zoomToward]
  );

  // React's onWheel is a passive listener by default, so preventDefault()
  // silently does nothing (and warns) — attach a native listener instead
  // so scrolling the page doesn't happen at the same time as zooming it.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomToward(event.clientX, event.clientY, factor);
    }

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [viewportRef, zoomToward]);

  return {
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    fit,
    zoomIn: () => zoomAtCenter(1.25),
    zoomOut: () => zoomAtCenter(0.8),
    zoomToward,
    setPanZoom: setState,
  };
}
