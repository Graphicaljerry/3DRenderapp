// Escape closes the thing on top.
//
// Every overlay in the app dismisses by its X or its backdrop, and not one of them
// listened for Escape — so the key that closes a dialog in every other program on the
// machine did nothing here, and a probe driving the UI would leave the backdrop up and
// have its next click swallowed. (That is how it was found.)
//
// A stack rather than a listener per modal, because the naive version closes EVERY open
// overlay at once: each component's own window listener fires on the same keystroke, so
// a lightbox opened over the library would take the library down with it. Only the
// last-mounted subscriber is called.

import { useEffect, useRef } from "react";

const stack: Array<() => void> = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !stack.length) return;
  // A modal on screen owns Escape even while a field inside it has focus — dismissing
  // the dialog IS what Escape means there, and no text field in one of these needs the
  // key for anything else.
  e.preventDefault();
  stack[stack.length - 1]();
}

/** Close this overlay on Escape, as long as nothing opened on top of it. */
export function useEscape(onEscape: () => void) {
  // Through a ref so the subscription is registered once on mount: passing the handler
  // itself would re-order the stack on every render that reallocates the callback, and
  // the topmost overlay would stop being the one that responds.
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    const entry = () => latest.current();
    stack.push(entry);
    if (!listening) {
      window.addEventListener("keydown", onKey);
      listening = true;
    }
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}
