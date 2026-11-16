/**
 * Apply a global replace until the string stops changing, so removing a match
 * cannot leave behind text that forms a new one (`<scr<script></script>ipt>`).
 */
export function replaceUntilStable(text: string, re: RegExp, replacement = ""): string {
  let out = text;
  for (let prev = ""; out !== prev; ) {
    prev = out;
    out = out.replace(re, replacement);
  }
  return out;
}
