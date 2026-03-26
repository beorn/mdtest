import { defineConfig } from "vitepress"

export default defineConfig({
  title: "mdspec",
  description: "Write tests in markdown. Run them as code.",
  base: "/mdspec/",
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/mdspec/favicon.svg" }],
    ["script", { defer: "", src: "https://static.cloudflareinsights.com/beacon.min.js", "data-cf-beacon": '{"token": "d9b13df1eca0424c884faea71f34e09f"}' }],
  ],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/cli" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Pattern Matching", link: "/guide/pattern-matching" },
          { text: "Persistent Context", link: "/guide/persistent-context" },
          { text: "Plugins", link: "/guide/plugins" },
          { text: "Custom Commands", link: "/guide/custom-commands" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "API", link: "/reference/api" },
          { text: "Block Options", link: "/reference/block-options" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/beorn/mdspec" }],
    footer: { message: "Released under the MIT License." },
    search: { provider: "local" },
  },
})
