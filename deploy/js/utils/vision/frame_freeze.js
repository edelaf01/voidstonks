/**
 * Freezes a video frame into a reusable canvas, so every stage of a pipeline that takes seconds looks at the
 * SAME image instead of reading the live `<video>` each time.
 *
 * The canvas is reused between calls: one per frame leaves backing stores the browser frees much slower than
 * the normal heap.
 */
/**
 * Releases the canvas: 0×0 frees the backing store, ~15 MB at 2560×1440. Called when leaving the screen that
 * used it.
 */
export function releaseFrame(cvs) {
  if (!cvs) return null;
  cvs.width = 0;
  cvs.height = 0;
  return null;
}

export function freezeFrame(source, width, height, prev = null) {
  const cvs = prev || document.createElement("canvas");
  // setting width/height clears the canvas, so it is only touched when the size really changes: the stream can
  // arrive rescaled mid session
  if (cvs.width !== width || cvs.height !== height) {
    cvs.width = width;
    cvs.height = height;
  }
  cvs.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, width, height);
  return cvs;
}
