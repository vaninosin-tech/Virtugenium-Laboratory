/**
 * How many of the tablet's on-screen keyboards (`ChemicalKeyboard`,
 * `SubstanceNameKeyboard`) are up right now. While one is, the physical
 * keyboard types into it — letter shortcuts such as E (open/close the
 * tablet) must stay out of the way.
 */
let mounted = 0;

/** Call from the keyboard's own key-listener effect; returns its cleanup. */
export function registerTypingKeyboard(): () => void {
  mounted += 1;
  return () => {
    mounted -= 1;
  };
}

export function isTypingKeyboardUp(): boolean {
  return mounted > 0;
}
