(function () {
  "use strict";
  if (window.StashAIToolbar) return;
  const api = window.PluginApi,
    R = api?.React;
  if (!R?.Children?.map || !api.patch?.before) return;
  const base = document.querySelector("base")?.getAttribute("href") || "/";
  const h = R.createElement;
  function insert(children) {
    return R.Children.map(children, (child) => {
      if (
        !R.isValidElement(child) ||
        child.props?.className === "stash-ai-settings-pair"
      )
        return child;
      if (
        child.props.to === "/settings" ||
        child.props.href === base + "settings"
      ) {
        // One layout slot preserves the user's saved Toolbar Order without writing
        // its storage. Both original Settings and the new anchor retain handlers.
        return h(
          "span",
          {
            className: "stash-ai-settings-pair",
            key: "stash-ai-settings-pair",
          },
          child,
          h(
            "a",
            {
              className: "nav-utility stash-ai-nav",
              href: base + "plugins/stash-ai",
              title: "Stash AI",
              "aria-label": "Stash AI",
            },
            h("img", {
              src: base + "plugin/stash-ai-command-center/assets/codex.png",
              width: 22,
              height: 22,
              alt: "",
              "aria-hidden": true,
            }),
          ),
        );
      }
      return child.props.children
        ? R.cloneElement(child, {}, insert(child.props.children))
        : child;
    });
  }
  api.patch.before("MainNavBar.UtilityItems", (props) => [
    { ...props, children: insert(props.children) },
  ]);
  window.StashAIToolbar = Object.freeze({ version: "0.11.2" });
})();
