import { expect, test } from "bun:test";
import { SEED, derive } from "../shared/state.js";
import { renderReader } from "../web/reader.js";

const view = derive(SEED);
const compiled = view.compiled;
if (!compiled.ok) throw new Error("seed must compile");
const html = renderReader(compiled.formatted, compiled.formattedSpans);
const text = html.replace(/<[^>]+>/g, "");

test("drops headers, section markers, comment markers and concept colons", () => {
  expect(text).not.toContain("***");
  expect(text).not.toContain("plaintype");
  expect(text).not.toContain(">");
  expect(text).not.toContain(":Button:");
});

test("definitions are bold, comments italic rows, attributes bulleted", () => {
  expect(html).toContain('<strong class="r-name"><mark class="slot slot-value" data-slot="typeName"');
  expect(html).toMatch(/<div class="r-row r-comment" style="--depth:0"><mark [^>]*data-slot="draftNote"[^>]*>This is a rough draft\.<\/mark><\/div>/);
  expect(html).toContain('<span class="r-bullet">•</span><span class="r-attr-name">priority</span>');
  expect(text).toContain("priority - The priority level: an integer between 1 and 5. For example: 2.");
});

test("every slot keeps a mark so hover still finds it", () => {
  for (const span of compiled.formattedSpans) expect(html).toContain(`data-slot="${span.slot}"`);
});

test("concept references lose their colons and are bold", () => {
  const source = "***plaintype 3***\n\n***definitions***\n\n- :Pet: A pet.\n  - owner - The owner - an :Owner:.\n";
  expect(renderReader(source, [])).toContain('an <strong class="r-ref">Owner</strong>.');
});
