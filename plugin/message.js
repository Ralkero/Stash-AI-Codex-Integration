(function () {
  "use strict";
  if (window.StashAIMessage) return;
  // Deliberately small Markdown subset. All content becomes React text nodes.
  // Only explicit local scene links are navigable; HTML/images are never parsed.
  window.StashAIMessage = function (h, text, base) {
    function inline(value) {
      const parts = value.split(
        /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(\/scenes\/[1-9]\d*\))/g,
      );
      return parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return h("strong", { key: i }, part.slice(2, -2));
        if (part.startsWith("`") && part.endsWith("`"))
          return h("code", { key: i }, part.slice(1, -1));
        const link = /^\[([^\]]+)\]\(\/scenes\/([1-9]\d*)\)$/.exec(part);
        if (link)
          return h("a", { key: i, href: base + "scenes/" + link[2] }, link[1]);
        return part;
      });
    }
    return String(text || "")
      .split(/(```[^\n]*\n[\s\S]*?```)/g)
      .map((part, i) =>
        part.startsWith("```")
          ? h(
              "pre",
              { key: i },
              h(
                "code",
                null,
                part.replace(/^```[^\n]*\n/, "").replace(/```$/, ""),
              ),
            )
          : h("div", { key: i }, ...blocks(part)),
      );
    function blocks(value) {
      const result = [],
        lines = value.split("\n");
      let paragraph = [],
        items = [],
        listType = null;
      const flushParagraph = () => {
        if (paragraph.length)
          result.push(
            h("p", { key: result.length }, ...inline(paragraph.join("\n"))),
          );
        paragraph = [];
      };
      const flushList = () => {
        if (items.length)
          result.push(
            h(
              listType,
              { key: result.length },
              ...items.map((item, key) => h("li", { key }, ...inline(item))),
            ),
          );
        items = [];
        listType = null;
      };
      for (const line of lines) {
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        const item = /^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
        if (heading) {
          flushParagraph();
          flushList();
          result.push(
            h(
              "h" + Math.min(6, heading[1].length + 2),
              { key: result.length },
              ...inline(heading[2]),
            ),
          );
        } else if (item) {
          flushParagraph();
          const type = item[1] ? "ul" : "ol";
          if (listType && listType !== type) flushList();
          listType = type;
          items.push(item[2]);
        } else if (!line.trim()) {
          flushParagraph();
          flushList();
        } else {
          flushList();
          paragraph.push(line);
        }
      }
      flushParagraph();
      flushList();
      return result;
    }
  };
})();
